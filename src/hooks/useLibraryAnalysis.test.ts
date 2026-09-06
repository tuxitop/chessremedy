import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '@/infrastructure/db/database';
import type { AnalysisJob, GameAnalysisStatus } from '@/domain/analysis';
import type { GameAnalysisProgress } from '@/infrastructure/analysis';
import type { AnalysisServiceLike } from '@/hooks/useGameAnalysis';
import { useLibraryAnalysis } from './useLibraryAnalysis';

/** Scriptable analysis service: each analyzeGames call queues behind manual releases. */
function createScriptedService(): {
  service: AnalysisServiceLike;
  analyzeCalls: string[][];
  releaseNext(): void;
  setStatus(id: string, status: GameAnalysisStatus): void;
} {
  const analyzeCalls: string[][] = [];
  const waiters: Array<() => void> = [];
  const statuses: Record<string, GameAnalysisStatus> = {};

  const service: AnalysisServiceLike = {
    async analyzeGames(gameIds) {
      analyzeCalls.push([...gameIds]);
      await new Promise<void>((resolve) => waiters.push(resolve));
      return gameIds.map(
        (gameId) =>
          ({ gameId, id: `${gameId}|job`, state: 'completed' as const }) as unknown as AnalysisJob,
      );
    },
    async statusesOf(gameIds) {
      const out: Record<string, GameAnalysisStatus> = {};
      for (const id of gameIds) out[id] = statuses[id] ?? 'unanalyzed';
      return out;
    },
    async listActiveJobs() {
      return [];
    },
    async cancelGame() {},
    async jobProgress(gameIds): Promise<Record<string, GameAnalysisProgress | undefined>> {
      const out: Record<string, GameAnalysisProgress | undefined> = {};
      for (const id of gameIds) {
        if (statuses[id] === 'inProgress') {
          out[id] = {
            state: 'inProgress',
            completedPositions: 1,
            totalPositions: 4,
            profile: 'normal',
          };
        }
      }
      return out;
    },
  };

  return {
    service,
    analyzeCalls,
    releaseNext() {
      waiters.shift()?.();
    },
    setStatus(id, status) {
      statuses[id] = status;
    },
  };
}

describe('useLibraryAnalysis — queueing (Feature 008 §5)', () => {
  it('keeps the active batch running and visible while a second batch is queued', async () => {
    await db.settings.clear();
    const scripted = createScriptedService();
    const { result } = renderHook(() => useLibraryAnalysis(scripted.service, ['a', 'b']));

    // Start batch A (game a) and, while it runs, request batch B (game b).
    act(() => {
      result.current.analyze(['a']);
    });
    await waitFor(() => expect(scripted.analyzeCalls).toEqual([['a']]));

    act(() => {
      result.current.analyze(['b']);
    });

    // B is queued behind A: it has not touched the engine and the active run
    // stays visible (running true, progress still for A's game).
    expect(scripted.analyzeCalls).toEqual([['a']]);
    await waitFor(() => expect(result.current.running).toBe(true));
    await waitFor(() => expect(result.current.queuedNote).toContain('1 more batch queued'));

    // A's game reports live progress while it is the active batch.
    act(() => scripted.setStatus('a', 'inProgress'));
    expect(result.current.perGameProgress).toEqual({});
    await waitFor(() => expect(result.current.perGameProgress.a?.totalPositions).toBe(4), {
      timeout: 3000,
    });

    // Releasing A starts B (the engine never ran both at once from this hook).
    act(() => scripted.releaseNext());
    await waitFor(() => expect(scripted.analyzeCalls).toEqual([['a'], ['b']]));

    // A is done; B is now the active batch and A's progress is cleared.
    await waitFor(() => expect(result.current.perGameProgress.a).toBeUndefined(), {
      timeout: 3000,
    });

    act(() => scripted.releaseNext());
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.queuedNote).toBeNull();
  });

  it('skips queued batches when the user cancels', async () => {
    await db.settings.clear();
    const scripted = createScriptedService();
    const { result } = renderHook(() => useLibraryAnalysis(scripted.service, ['a', 'b']));

    act(() => {
      result.current.analyze(['a']);
      result.current.analyze(['b']);
    });
    await waitFor(() => expect(scripted.analyzeCalls).toEqual([['a']]));

    // Cancel clears the queued (not-yet-started) batch.
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.queuedNote).toBeNull();
  });

  it('surfaces a queued game as queued on its row while it waits', async () => {
    await db.settings.clear();
    const scripted = createScriptedService();
    const { result } = renderHook(() => useLibraryAnalysis(scripted.service, ['a', 'b']));

    // Game b is already analyzed (completed); the user re-analyzes it while
    // game a is still running → b is queued and must read `queued`, not
    // completed/unanalyzed, so its row changes immediately.
    scripted.setStatus('a', 'inProgress');
    act(() => {
      scripted.setStatus('b', 'completed');
      result.current.analyze(['a']);
      result.current.reanalyze('b');
    });

    await waitFor(() => expect(scripted.analyzeCalls).toEqual([['a']]));
    await waitFor(() => expect(result.current.statuses.b).toBe('queued'));
    expect(result.current.statuses.a).toBe('inProgress');
    expect(result.current.queuedNote).toContain('1 more batch queued');
  });

  it('pulls a queued game out of the queue via per-row cancel so it never runs', async () => {
    await db.settings.clear();
    const scripted = createScriptedService();
    const { result } = renderHook(() => useLibraryAnalysis(scripted.service, ['a', 'b']));

    act(() => {
      result.current.analyze(['a']);
      result.current.analyze(['b']);
    });
    await waitFor(() => expect(scripted.analyzeCalls).toEqual([['a']]));
    await waitFor(() => expect(result.current.statuses.b).toBe('queued'));

    // Per-row cancel of the queued game removes it; the active batch continues.
    act(() => result.current.cancelGame('b'));
    await waitFor(() => expect(result.current.statuses.b).toBe('unanalyzed'));
    expect(result.current.queuedNote).toBeNull();

    // Releasing A does NOT start b (it was dequeued).
    act(() => scripted.releaseNext());
    await waitFor(() => expect(scripted.analyzeCalls).toEqual([['a']]));
    await waitFor(() => expect(result.current.running).toBe(false));
  });

  it('counts the queued game in the top progress line the moment it is queued', async () => {
    await db.settings.clear();
    const scripted = createScriptedService();
    scripted.setStatus('a', 'inProgress');
    const { result } = renderHook(() => useLibraryAnalysis(scripted.service, ['a', 'b']));

    await waitFor(() => expect(result.current.statuses.a).toBe('inProgress'));
    act(() => {
      result.current.analyze(['a']);
    });
    await waitFor(() => expect(scripted.analyzeCalls).toEqual([['a']]));
    expect(result.current.progressLine).toContain('Analyzing 1 of 1 games');

    // While A runs, queue B: the banner must widen immediately to 1 of 2.
    act(() => {
      result.current.analyze(['b']);
    });
    await waitFor(() => expect(result.current.statuses.b).toBe('queued'));
    await waitFor(() => expect(result.current.progressLine).toContain('Analyzing 1 of 2 games'));
    expect(result.current.running).toBe(true);

    // A's live job drives the aggregate positions; the queued game has none yet.
    await waitFor(() => expect(result.current.perGameProgress.a).toBeDefined(), {
      timeout: 3000,
    });
    expect(result.current.positions).toEqual({ done: 1, total: 4 });

    act(() => scripted.releaseNext());
    await waitFor(() => expect(scripted.analyzeCalls).toEqual([['a'], ['b']]));
    act(() => scripted.releaseNext());
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.progressLine).toBeNull();
    expect(result.current.positions).toBeNull();
  });
});
