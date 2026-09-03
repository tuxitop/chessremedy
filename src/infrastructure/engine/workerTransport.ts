/**
 * Browser engine Worker transport (Feature 005).
 *
 * This is the only module in the engine layer that touches the `Worker`
 * global. It wraps a classic Worker running a stockfish.js engine script
 * (ADR-012) behind the `EngineTransport` interface so the rest of the engine
 * layer is Node-testable (ADR-009).
 *
 * The stockfish.js worker scripts speak line-based UCI over
 * `postMessage`/`onmessage`: the main thread posts UCI command strings and
 * the worker posts each engine output line as a separate string message.
 * Structured messages (e.g. download progress) are tolerated and ignored.
 * Multi-line strings are split defensively.
 */

import type { EngineTransport } from './types';

export interface StockfishWorkerTransportOptions {
  /** Absolute or base-relative URL of the engine worker script. */
  readonly scriptUrl: string;
}

export function createStockfishWorkerTransport(
  options: StockfishWorkerTransportOptions,
): EngineTransport {
  let worker: Worker | null = null;
  const outputListeners = new Set<(line: string) => void>();
  const errorListeners = new Set<(error: unknown) => void>();

  const emitOutput = (data: unknown): void => {
    if (typeof data !== 'string') {
      // Tolerate structured messages from some engine builds; not UCI output.
      return;
    }
    for (const line of data.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      for (const listener of outputListeners) {
        listener(trimmed);
      }
    }
  };

  return {
    start(): Promise<void> {
      if (worker) return Promise.resolve();
      worker = new Worker(options.scriptUrl);
      worker.onmessage = (event: MessageEvent) => emitOutput(event.data);
      worker.onerror = (event: ErrorEvent) => {
        const err = event.error ?? new Error(event.message || 'Engine worker error.');
        for (const listener of errorListeners) {
          listener(err);
        }
        // Prevent the browser default (log + report) from double reporting.
        event.preventDefault();
      };
      return Promise.resolve();
    },

    send(command: string): void {
      if (!worker) {
        throw new Error('Engine worker transport has not been started.');
      }
      worker.postMessage(command);
    },

    onOutput(listener: (line: string) => void): () => void {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },

    onError(listener: (error: unknown) => void): () => void {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },

    async terminate(): Promise<void> {
      const current = worker;
      worker = null;
      if (current) {
        current.terminate();
      }
    },
  };
}
