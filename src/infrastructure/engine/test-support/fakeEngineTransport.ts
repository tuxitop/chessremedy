/**
 * Scriptable fake engine transport for engine-service unit tests.
 *
 * Simulates a stockfish.js Worker over the `EngineTransport` interface: it
 * records sent UCI commands, auto-completes the UCI handshake, and lets tests
 * drive search output (info/bestmove lines) or errors deterministically —
 * no real Worker, WASM, or timers required (ADR-009).
 */

import type { EngineTransport } from '../types';

export const DEFAULT_INFO_LINE =
  'info depth 3 seldepth 4 multipv 1 score cp 21 nodes 300 nps 150 time 6 pv e2e4 e7e5';
export const DEFAULT_BESTMOVE = 'bestmove e2e4 ponder e7e5';

export class FakeEngineTransport implements EngineTransport {
  readonly sent: string[] = [];
  starts = 0;
  terminated = false;
  autoHandshake = true;
  /** When true, a `go` command schedules search output automatically. */
  autoSearch = true;
  /** Lines emitted for a `go` search when `autoSearch` is true. */
  searchLines: string[] = [DEFAULT_INFO_LINE, DEFAULT_BESTMOVE];

  private readonly outputListeners = new Set<(line: string) => void>();
  private readonly errorListeners = new Set<(error: unknown) => void>();

  start(): Promise<void> {
    this.starts += 1;
    return Promise.resolve();
  }

  send(command: string): void {
    this.sent.push(command);
    if (this.autoHandshake) {
      if (command === 'uci') {
        this.schedule(() => this.emit('id name Stockfish test'));
        this.schedule(() => this.emit('uciok'));
      } else if (command === 'isready') {
        this.schedule(() => this.emit('readyok'));
      }
    }
    if (this.autoSearch && command.startsWith('go ')) {
      this.schedule(() => {
        for (const line of this.searchLines) {
          this.emit(line);
        }
      });
    }
  }

  onOutput(listener: (line: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onError(listener: (error: unknown) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async terminate(): Promise<void> {
    this.terminated = true;
  }

  emit(line: string): void {
    for (const listener of this.outputListeners) {
      listener(line);
    }
  }

  emitError(error: unknown): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  private schedule(fn: () => void): void {
    queueMicrotask(fn);
  }
}

export interface FakeEngineRig {
  /** Every transport the factory has produced, in order. */
  readonly transports: FakeEngineTransport[];
  readonly factory: () => FakeEngineTransport;
}

/** A transport factory that returns a fresh fake on every call. */
export function createFakeEngineFactory(
  configure?: (transport: FakeEngineTransport) => void,
): FakeEngineRig {
  const transports: FakeEngineTransport[] = [];
  const factory = (): FakeEngineTransport => {
    const transport = new FakeEngineTransport();
    configure?.(transport);
    transports.push(transport);
    return transport;
  };
  return { transports, factory };
}

/** Poll until `predicate` is true (driving the microtask queue), else throw. */
export async function until(
  predicate: () => boolean,
  message = 'condition not met',
): Promise<void> {
  for (let i = 0; i < 2000; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`until() timed out: ${message}`);
}
