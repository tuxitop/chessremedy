/**
 * Feature 014 Stage D — `AnalysisRepository.listForAnalyses` tests.
 *
 * The batched read-only phase-metric source: one query over the existing
 * `analysisId` index, ordered deterministically by `[analysisId, ply]`, with an
 * empty input as a no-op.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeMove, makeRecords } from '@/domain/analysis/test-support';
import { analysesRepository } from './analysis-repository';
import { db } from './database';

const GAME_A = 'lichess:aaa';
const GAME_B = 'lichess:bbb';
const ANALYSIS_A = `${GAME_A}|a1`;
const ANALYSIS_B = `${GAME_A}|a2`;
const ANALYSIS_C = `${GAME_B}|a1`;

describe('AnalysisRepository.listForAnalyses', () => {
  beforeEach(async () => {
    await db.analyses.clear();
  });

  it('returns an empty list for an empty input', async () => {
    expect(await analysesRepository.listForAnalyses([])).toEqual([]);
  });

  it('batches across analysis ids and orders by [analysisId, ply]', async () => {
    await analysesRepository.replaceAnalysis(makeRecords(GAME_A, ANALYSIS_B, 2));
    await analysesRepository.replaceAnalysis(makeRecords(GAME_A, ANALYSIS_A, 3));
    await analysesRepository.replaceAnalysis(makeRecords(GAME_B, ANALYSIS_C, 1));

    const rows = await analysesRepository.listForAnalyses([ANALYSIS_B, ANALYSIS_A, ANALYSIS_C]);
    expect(rows.map((row) => `${row.analysisId}:${row.ply}`)).toEqual([
      `${ANALYSIS_A}:0`,
      `${ANALYSIS_A}:1`,
      `${ANALYSIS_A}:2`,
      `${ANALYSIS_B}:0`,
      `${ANALYSIS_B}:1`,
      `${ANALYSIS_C}:0`,
    ]);
  });

  it('orders plies ascending within one analysis regardless of write order', async () => {
    await analysesRepository.replaceAnalysis([
      makeMove(4, { gameId: GAME_A, analysisId: ANALYSIS_A }),
      makeMove(0, { gameId: GAME_A, analysisId: ANALYSIS_A }),
      makeMove(2, { gameId: GAME_A, analysisId: ANALYSIS_A }),
    ]);

    const rows = await analysesRepository.listForAnalyses([ANALYSIS_A]);
    expect(rows.map((row) => row.ply)).toEqual([0, 2, 4]);
  });

  it('omits analysis ids with no persisted records', async () => {
    await analysesRepository.replaceAnalysis(makeRecords(GAME_A, ANALYSIS_A, 1));

    const rows = await analysesRepository.listForAnalyses([ANALYSIS_A, 'missing']);
    expect(rows.map((row) => row.analysisId)).toEqual([ANALYSIS_A]);
  });
});
