import { EventEmitter } from 'events';
import * as pty from 'node-pty';

interface PtyProcessEvents {
  data: (chunk: string) => void;
  exit: (exitCode: number | undefined) => void;
}

export class PtyProcess extends EventEmitter {
  private pty: pty.IPty;

  constructor(command: string, args: string[], cwd: string) {
    super();
    this.pty = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 220,
      rows: 50,
      cwd,
      env: process.env as Record<string, string>,
    });

    this.pty.onData((data) => this.emit('data', data));
    this.pty.onExit(({ exitCode }) => this.emit('exit', exitCode));
  }

  write(input: string): void {
    this.pty.write(input);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(): void {
    try {
      this.pty.kill();
    } catch {
      // process may already be dead
    }
  }

  get pid(): number {
    return this.pty.pid;
  }

  // Typed event emitter overloads
  on(event: 'data', listener: PtyProcessEvents['data']): this;
  on(event: 'exit', listener: PtyProcessEvents['exit']): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
