import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import * as fs from 'fs';
import * as path from 'path';

// Vite bundles main/preload/renderer; only these modules are externalized and
// must remain on disk at runtime (see vite.main.config.ts).
const RUNTIME_NATIVE_MODULES = [
  'node-pty',
  'better-sqlite3',
  'sqlite-vec',
  'node-llama-cpp',
  'uiohook-napi',
  '@fugood/whisper.node',
];

// BFS the production-dep closure starting from the runtime native modules,
// returning paths in `/node_modules/...` form (relative to the project root).
function computeAllowlist(roots: string[], cwd: string): Set<string> {
  const allow = new Set<string>();
  const queue: Array<{ name: string; from: string }> = roots.map((n) => ({ name: n, from: cwd }));
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { name, from } = item;
    const pkgJsonPath = resolvePkgJson(name, from);
    if (!pkgJsonPath) continue;
    const dir = path.dirname(pkgJsonPath);
    const idx = dir.indexOf('/node_modules/');
    if (idx < 0) continue;
    const rel = dir.slice(idx);
    if (allow.has(rel)) continue;
    allow.add(rel);
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
      for (const dep of Object.keys(deps)) queue.push({ name: dep, from: dir });
    } catch {
      // ignore unreadable packages
    }
  }
  return allow;
}

// Locate `<name>/package.json` by walking up node_modules ancestors.
// (We don't use require.resolve because some packages — e.g. sqlite-vec,
// node-llama-cpp — restrict their `exports` field and hide `./package.json`.)
function resolvePkgJson(name: string, from: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const allowlist = computeAllowlist(RUNTIME_NATIVE_MODULES, __dirname);

// Ancestor directories of allowlisted paths (e.g. "/node_modules/@scope") must
// not be ignored — otherwise packager won't descend into them.
const allowedAncestors = new Set<string>();
for (const p of allowlist) {
  let i = p.lastIndexOf('/');
  while (i > 0) {
    allowedAncestors.add(p.slice(0, i));
    i = p.lastIndexOf('/', i - 1);
  }
}

// node-pty ships prebuilt binaries for every platform (~58MB of foreign-platform
// binaries on a single-platform build). Keep only the host's.
const HOST_PREBUILD_PREFIX = `${process.platform}-`;
const NODE_PTY_PREBUILD_RE = /^\/node_modules\/node-pty\/prebuilds\/([^/]+)/;

function isForeignNodePtyPrebuild(file: string): boolean {
  const m = NODE_PTY_PREBUILD_RE.exec(file);
  return m !== null && !m[1].startsWith(HOST_PREBUILD_PREFIX);
}

const osxSign =
  process.env.CSC_LINK && process.env.CSC_NAME
    ? {
        identity: process.env.CSC_NAME,
        hardenedRuntime: true,
      }
    : undefined;

const osxNotarize =
  process.env.CSC_LINK && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    // prune:false disables galactus/flora-colossus dep-walking, which fails when
    // many prod deps reference devDeps (like @types/react) as peers. The ignore
    // function below replaces pruning with an explicit allowlist of runtime-
    // native modules + their prod-dep closure. Everything else in node_modules
    // (pure-JS deps, build tooling, test libs, Vite's dev cache) is dropped —
    // Vite already bundles those into .vite/{build,renderer}.
    prune: false,
    ignore: (file: string) => {
      if (!file) return false;
      if (file === '/package.json') return false;
      if (file === '/.vite') return false;
      if (file.startsWith('/.vite/build') || file.startsWith('/.vite/renderer')) return false;

      if (file === '/node_modules') return false;
      if (!file.startsWith('/node_modules/')) return true;

      if (file.startsWith('/node_modules/.vite') || file.startsWith('/node_modules/.bin')) return true;
      if (isForeignNodePtyPrebuild(file)) return true;

      // Include file if it's an allowed dir, an ancestor of one, or inside one.
      if (allowlist.has(file) || allowedAncestors.has(file)) return false;
      let i = file.lastIndexOf('/');
      while (i > '/node_modules'.length) {
        if (allowlist.has(file.slice(0, i))) return false;
        i = file.lastIndexOf('/', i - 1);
      }
      return true;
    },
    // node-pty .node binary must live outside ASAR
    asar: {
      unpack:
        '**/node_modules/{node-pty,better-sqlite3,sqlite-vec,node-llama-cpp,@node-llama-cpp,uiohook-napi,@fugood}/**',
    },
    // icon: platform-specific — forge picks .icns (macOS), .ico (Windows), .png (Linux)
    appBundleId: 'com.agentos.app',
    icon: 'resources/agentos-logo',
    extraResource: [
      'resources/Dockerfile.sandbox',
      'resources/entrypoint.sh',
      'resources/seccomp-sandbox.json',
      'resources/bundled-skills',
      'resources/bin',
      'resources/agentos-logo-512.png',
      'node_modules/web-tree-sitter/tree-sitter.wasm',
      'node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm',
      'node_modules/tree-sitter-wasms/out/tree-sitter-tsx.wasm',
      'node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm',
      'node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm',
    ],
    osxSign,
    osxNotarize,
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG({
      background: path.join(__dirname, 'resources', 'dmg-background.png'),
      icon: path.join(__dirname, 'resources', 'agentos-logo.icns'),
      iconSize: 80,
      additionalDMGOptions: {
        window: {
          position: { x: 400, y: 200 },
          size: { width: 660, height: 400 },
        },
      },
      // Positions match arrow drawn in dmg-background.png (app left, Applications right).
      // Function form is required so electron-installer-dmg injects opts.appPath into the
      // file entry — appdmg's schema rejects file entries without `path`.
      contents: (opts) => [
        { x: 165, y: 190, type: 'file', path: opts.appPath },
        { x: 495, y: 190, type: 'link', path: '/Applications' },
      ],
      format: 'UDZO',
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'shinydrift', name: 'workspace' },
      draft: false,
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/main/memory/worker/indexer.ts',
          config: 'vite.indexer.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
