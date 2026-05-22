import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import type { SendInputRequest, ResizeTerminalRequest } from '../../../shared/types';
import { threadManager, threadReads } from '../../sessions/ThreadManager';
import { threadId, ThreadIdSchema } from './schemas';
import { handleIpc } from '../ipcResponse';

const SendInputSchema: z.ZodType<SendInputRequest> = z.object({
  threadId,
  input: z.string().max(100_000),
});

const ResizeTerminalSchema: z.ZodType<ResizeTerminalRequest> = z.object({
  threadId,
  cols: z.number().int().positive().max(1000),
  rows: z.number().int().positive().max(500),
});

export function registerTerminalHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.TERMINAL_SEND_INPUT, (_e, raw) =>
    handleIpc(() => {
      const req = SendInputSchema.parse(raw);
      return threadManager.sendInput(req.threadId, req.input, 'user');
    })
  );

  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, (_e, raw) =>
    handleIpc(() => {
      const req = ResizeTerminalSchema.parse(raw);
      threadManager.resizeTerminal(req.threadId, req.cols, req.rows);
    })
  );

  ipcMain.handle(IPC_CHANNELS.TERMINAL_GET_HISTORY, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      return threadReads.getLogHistory(id);
    })
  );
}
