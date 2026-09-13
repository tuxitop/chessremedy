/**
 * Missed-tactic summary repair tests (Feature 009/010).
 *
 * The repair rebuilds the classification counts of completed per-analysis
 * summaries from the stored `MoveAnalysis` records, fixing the double count
 * where a verified missed tactic stayed in its raw `blunder` bucket. It is
 * engine-free, idempotent, guarded by a settings marker and never throws.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import type { MoveAnalysis } from '@/domain/chess';
import { makeMove } from '@/domain/analysis/test-support';
import { buildAnalysisSummary } from '@/domain/analysis/summaryDerivation';
import { DETECTION_VERSION } from '@/domain/tactics';
import {
  MISSED_TACTIC_SUMMARY_REPAIR_VERSION,
  repairMissedTacticSummaries,
  type SummaryRepairDeps,
} from './summary-repair';

const GAME_ID = 'fixture:repair';
const ANALYSIS_ID = 'analysis:repair';

/** A user (White) blunder that is also a current-version verified missed tactic. */
function missedTacticRecord(ply: number): MoveAnalysis {
  return makeMove(ply, {
    gameId: GAME_ID,
    analysisId: ANALYSIS_ID,
    side: 'white',
    classification: 'blunder',
    missedTactic: true,
    detectionVersion: DETECTION_VERSION,
  });
}

/** A clean user move plus the missed-tactic ply. */
function records(): MoveAnalysis[] {
  return [
    makeMove(0, { gameId: GAME_ID, analysisId: ANALYSIS_ID, side: 'white' }),
    missedTacticRecord(2),
  ];
}

/** A completed summary with the pre-fix (double-counted) blunder count. */
function buggySummary(recordsIn: readonly MoveAnalysis[]): AnalysisSummaryRow {
  const correct = buildAnalysisSummary(recordsIn, 'white', {
    detectionState: 'completed',
    detectionVersion: DETECTION_VERSION,
  });
  return {
    analysisId: ANALYSIS_ID,
    gameId: GAME_ID,
    userColor: 'white',
    ...correct,
    // Simulate the persisted bug: the verified miss is also counted as a blunder.
    classificationCounts: { ...correct.classificationCounts, blunder: 1 },
    missedTacticCount: 1,
    puzzleState: 'completed',
    puzzleProgress: null,
    puzzleGeneratorVersion: 7,
    updatedAt: 1,
  };
}

function makeDeps(
  summary: AnalysisSummaryRow,
  rows: readonly MoveAnalysis[],
): {
  readonly deps: SummaryRepairDeps;
  readonly written: AnalysisSummaryRow[];
  readonly settings: Map<string, unknown>;
} {
  const written: AnalysisSummaryRow[] = [];
  const settings = new Map<string, unknown>();
  const deps: SummaryRepairDeps = {
    analyses: { listForGameAndAnalysis: async () => [...rows] },
    summaries: {
      listAll: async () => [summary],
      putForAnalysis: async (next) => {
        written.push(next);
      },
    },
    settings: {
      get: async <T>(key: string) => settings.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        settings.set(key, value);
      },
    },
    now: () => 999,
  };
  return { deps, written, settings };
}

describe('repairMissedTacticSummaries', () => {
  it('removes a verified missed tactic from the blunder count and preserves puzzle fields', async () => {
    const rows = records();
    const { deps, written, settings } = makeDeps(buggySummary(rows), rows);

    const result = await repairMissedTacticSummaries(deps);

    expect(result.status).toBe('repaired');
    expect(result.scanned).toBe(1);
    expect(result.rewritten).toBe(1);
    const patched = written[0]!;
    expect(patched.classificationCounts.blunder).toBe(0);
    expect(patched.missedTacticCount).toBe(1);
    // Derived-count patch only: puzzle fields and provenance are preserved.
    expect(patched.puzzleState).toBe('completed');
    expect(patched.puzzleGeneratorVersion).toBe(7);
    expect(patched.detectionState).toBe('completed');
    expect(patched.detectionVersion).toBe(DETECTION_VERSION);
    expect(patched.updatedAt).toBe(999);
    expect(settings.get('analysis.missedTacticSummaryRepair')).toBe(
      MISSED_TACTIC_SUMMARY_REPAIR_VERSION,
    );
  });

  it('is idempotent: a second run is a guarded no-op', async () => {
    const rows = records();
    const { deps, written, settings } = makeDeps(buggySummary(rows), rows);

    await repairMissedTacticSummaries(deps);
    settings.set('analysis.missedTacticSummaryRepair', MISSED_TACTIC_SUMMARY_REPAIR_VERSION);
    const second = await repairMissedTacticSummaries(deps);

    expect(second).toEqual({ status: 'already-repaired', scanned: 0, rewritten: 0 });
    expect(written).toHaveLength(1);
  });

  it('leaves an already-correct summary untouched', async () => {
    const rows = records();
    const summary = buggySummary(rows);
    const correct: AnalysisSummaryRow = {
      ...summary,
      classificationCounts: { ...summary.classificationCounts, blunder: 0 },
    };
    const { deps, written } = makeDeps(correct, rows);

    const result = await repairMissedTacticSummaries(deps);

    expect(result.rewritten).toBe(0);
    expect(written).toHaveLength(0);
  });

  it('skips summaries whose detection is not completed', async () => {
    const rows = records();
    const summary: AnalysisSummaryRow = { ...buggySummary(rows), detectionState: 'queued' };
    const { deps, written } = makeDeps(summary, rows);

    const result = await repairMissedTacticSummaries(deps);

    expect(result.scanned).toBe(0);
    expect(written).toHaveLength(0);
  });

  it('never throws and does not write the marker when a dependency fails', async () => {
    const deps: SummaryRepairDeps = {
      analyses: { listForGameAndAnalysis: async () => [] },
      summaries: {
        listAll: async () => {
          throw new Error('boom');
        },
        putForAnalysis: async () => {},
      },
      settings: {
        get: async () => undefined,
        set: vi.fn(async () => {}),
      },
    };

    await expect(repairMissedTacticSummaries(deps)).resolves.toEqual({
      status: 'failed',
      scanned: 0,
      rewritten: 0,
    });
    expect(deps.settings.set).not.toHaveBeenCalled();
  });
});
