import * as threadStore from '../threads/threadStore';
import { broadcastThreadCreated, broadcastTerminalData, broadcastStatus } from './broadcaster';
import { PtyProcess } from './PtyProcess';
import { ThreadRuntimeStore } from './ThreadRuntimeStore';
import { ThreadOutputManager } from './threadOutput';
import type { Thread, ThreadStatus } from '../../shared/types';

export class EmbeddedChildThreadRunner {
  constructor(
    private readonly store: ThreadRuntimeStore,
    private readonly output: ThreadOutputManager
  ) {}

  setup(opts: {
    childThread: Omit<Thread, 'logBuffer'>;
    proc: PtyProcess;
    onExit?: (exitCode: number | null) => void;
  }): void {
    const { childThread, proc, onExit } = opts;
    const childId = childThread.id;

    threadStore.saveThread(childThread);
    this.output.initLogBuffer(childId);
    this.output.openLogStream(childId);
    broadcastThreadCreated({ ...childThread, logBuffer: [] });

    this.store.ptys.set(childId, proc);

    proc.on('data', (data: string) => {
      this.output.appendLog(childId, data);
      broadcastTerminalData({ threadId: childId, data });
    });

    proc.on('exit', (exitCode) => {
      this.store.ptys.delete(childId);
      // Embedded children (council members, kanban stage workers) run the entire
      // exchange — multiple LLM rounds with tool calls — in a single process and
      // only flush at exit. Use multi-turn normalization so each LLM round becomes
      // its own message instead of collapsing into one merged assistant blob.
      this.output.flushAssistantMessage(childId, { multiTurn: true });
      this.output.closeLogStream(childId);
      const finalStatus: ThreadStatus = exitCode === 0 ? 'stopped' : 'error';
      threadStore.updateThread(childId, { status: finalStatus, exitCode: exitCode ?? null });
      broadcastStatus({ threadId: childId, status: finalStatus });
      onExit?.(exitCode);
    });
  }
}
