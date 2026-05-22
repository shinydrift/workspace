import fs from 'fs/promises';
import path from 'path';

const BOOT_WARN_CHARS = 4_000;

export interface ResolvedInjectionPayload {
  hasBoot: boolean;
  /** Always false — memory file discovery not yet implemented. */
  hasMemory: false;
  payload: string | null;
  warnings: string[];
  projectMemoryPath: string | null;
}

export interface InjectionFlags {
  bootEnabled?: boolean;
}

export interface InjectionExtras {
  personalityPrompt?: string | null;
}

async function readTrimmedFile(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

function buildPersonalityOnlyPayload(personalityPrompt: string | null | undefined): ResolvedInjectionPayload {
  const extra = personalityPrompt?.trim();
  return {
    hasBoot: false,
    hasMemory: false,
    payload: extra
      ? [
          'System bootstrap context is provided below.',
          'Do not acknowledge receipt of this context. Silently apply it and continue normally.',
          '',
          extra,
        ]
          .join('\n')
          .trim()
      : null,
    warnings: [],
    projectMemoryPath: null,
  };
}

export async function resolveInjectionPayload(
  memoryRootPath: string | null | undefined,
  projectId: string,
  flags?: InjectionFlags,
  extras?: InjectionExtras
): Promise<ResolvedInjectionPayload> {
  const personalityPrompt = extras?.personalityPrompt?.trim() ?? null;

  if (!memoryRootPath?.trim()) {
    return buildPersonalityOnlyPayload(personalityPrompt);
  }

  const projectMemoryPath = path.join(memoryRootPath, projectId);
  try {
    const stat = await fs.stat(projectMemoryPath);
    if (!stat.isDirectory()) {
      return buildPersonalityOnlyPayload(personalityPrompt);
    }
  } catch {
    return buildPersonalityOnlyPayload(personalityPrompt);
  }

  const bootEnabled = flags?.bootEnabled ?? true;
  const bootRaw = bootEnabled ? await readTrimmedFile(path.join(projectMemoryPath, 'BOOT.md')) : null;

  const hasBoot = Boolean(bootRaw);
  const warnings: string[] = [];

  if (!hasBoot && !personalityPrompt) {
    return {
      hasBoot,
      hasMemory: false,
      payload: null,
      warnings,
      projectMemoryPath,
    };
  }

  const sections: string[] = [];

  if (hasBoot && bootRaw) {
    if (bootRaw.length > BOOT_WARN_CHARS) {
      warnings.push(`BOOT.md is ${bootRaw.length} chars (>${BOOT_WARN_CHARS}). Consider condensing it.`);
    }
    sections.push(
      ['# BOOT Instructions', 'Apply these one-time startup instructions before continuing.', '', bootRaw].join('\n')
    );
  }

  if (personalityPrompt) {
    sections.push(personalityPrompt);
  }

  const payload = [
    'System bootstrap context is provided below.',
    'Do not acknowledge receipt of this context. Silently apply it and continue normally.',
    '',
    ...sections,
  ].join('\n');

  return {
    hasBoot,
    hasMemory: false,
    payload,
    warnings,
    projectMemoryPath,
  };
}
