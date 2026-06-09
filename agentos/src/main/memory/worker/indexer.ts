// Memory indexer utility process.
//
// Owns better-sqlite3, tree-sitter WASM, node-llama-cpp, the embedding queue,
// and the file watchers. The main process talks to this via the IPC envelope
// in ./ipc.ts. Heavy work that used to stall the Electron main loop (sqlite
// transactions, tree-sitter parsing, local llama inference) runs here.

import { createRequire } from 'module';
import { installMemoryRuntime } from '../runtime';
import { createWorkerMemoryRuntime, type WorkerMemoryRuntime } from '../runtime/workerImpl';
import { initDbDir, closeAllDbs } from '../projectDb';
import { agentOSMemoryWorker, type WorkerEntry } from './entry';
import type { WorkerMessage, WorkerOutbound, WorkerRequest, WorkerEvent, WorkerReady } from './ipc';

interface ParentPortLike {
  postMessage: (msg: WorkerOutbound) => void;
  on: (event: 'message', listener: (event: { data: WorkerMessage }) => void) => void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  console.error('[memory-indexer] missing parentPort — must be spawned via utilityProcess.fork');
  process.exit(1);
}

function send(msg: WorkerOutbound): void {
  parentPort!.postMessage(msg);
}

function probeNativeModules(): WorkerReady['probe'] {
  const probe: WorkerReady['probe'] = {
    betterSqlite3: false,
    sqliteVec: false,
    nodeLlamaCpp: false,
    errors: [],
  };
  // createRequire gives us a sync probe without polluting the module graph
  // with optional native dependencies we'd otherwise have to top-level await.
  const req = createRequire(import.meta.url);
  for (const [name, key] of [
    ['better-sqlite3', 'betterSqlite3'],
    ['sqlite-vec', 'sqliteVec'],
    ['node-llama-cpp', 'nodeLlamaCpp'],
  ] as const) {
    try {
      req(name);
      probe[key] = true;
    } catch (err) {
      probe.errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return probe;
}

let runtime: WorkerMemoryRuntime | null = null;
let entry: WorkerEntry | null = null;
let shuttingDown = false;

async function handleRequest(req: WorkerRequest): Promise<void> {
  const respond = (result: unknown): void => send({ kind: 'response', id: req.id, result });
  const fail = (err: unknown): void =>
    send({
      kind: 'response',
      id: req.id,
      error: { message: err instanceof Error ? err.message : String(err) },
    });

  try {
    if (req.method === '__init__') {
      const init = req.args as {
        homeDir: string;
        settings: import('../../../shared/types').AppSettings;
        projects: import('../../../shared/types').SavedProject[];
        threads: import('../runtime').RuntimeThread[];
      };
      initDbDir(init.homeDir);
      runtime = createWorkerMemoryRuntime(
        { settings: init.settings, projects: init.projects, threads: init.threads },
        {
          sendEvent: (channel, payload) => send({ kind: 'event', channel, payload }),
        }
      );
      installMemoryRuntime(runtime);
      entry = agentOSMemoryWorker();
      entry.configure(init.homeDir);
      respond(null);
      return;
    }
    if (!entry) throw new Error('Memory worker not initialized (init request missing).');
    const result = await entry.dispatch(req.method, req.args);
    respond(result);
  } catch (err) {
    fail(err);
  }
}

function handleEvent(evt: WorkerEvent): void {
  if (!runtime) return;
  switch (evt.channel) {
    case 'runtime:settings':
      runtime.applySettings(evt.payload as import('../../../shared/types').AppSettings);
      break;
    case 'runtime:projects':
      runtime.applyProjects(evt.payload as import('../../../shared/types').SavedProject[]);
      break;
    case 'runtime:threads':
      runtime.applyThreads(evt.payload as import('../runtime').RuntimeThread[]);
      break;
    default:
      break;
  }
}

async function gracefulShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (entry) await entry.flushPending();
  } catch {
    /* swallow — shutting down anyway */
  }
  try {
    closeAllDbs();
  } catch {
    /* swallow */
  }
}

parentPort.on('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'request') {
    if (msg.method === '__shutdown__') {
      gracefulShutdown().finally(() => {
        send({ kind: 'response', id: msg.id, result: null });
        setImmediate(() => process.exit(0));
      });
      return;
    }
    void handleRequest(msg);
  } else if (msg.kind === 'event') {
    handleEvent(msg);
  }
});

send({ kind: 'ready', probe: probeNativeModules() });
