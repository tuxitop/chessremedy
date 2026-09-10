import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AnalysisJob,
  AnalysisJobOutcome,
  EngineAnalysisResult,
  EngineJobError,
  EngineServiceStatus,
} from '@/infrastructure/engine/types';
import { useLiveAnalysis, type LiveEngineService } from './useLiveAnalysis';

const FEN = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

const STATUS: EngineServiceStatus = {
  lifecycle: 'ready',
  engine: { engineName: 'stockfish', engineVersion: '18.0.8', engineBuild: 'stockfish-18-lite' },
  build: 'lite',
  activeJobId: null,
  queued: 0,
};

function settledJob(outcome: AnalysisJobOutcome, status: 'failed' | 'completed'): AnalysisJob {
  return {
    id: 'job-1',
    fen: FEN,
    profile: 'normal',
    status,
    subscribe: () => () => {},
    outcome: Promise.resolve(outcome),
    cancel: () => {},
  };
}

function serviceReturning(job: AnalysisJob): LiveEngineService {
  return {
    analyze: () => job,
    cancel: () => {},
    getStatus: () => STATUS,
    onStatusChange: () => () => {},
  };
}

describe('useLiveAnalysis — synchronously settled jobs', () => {
  it('surfaces the error when the job already failed before subscribe', async () => {
    const error: EngineJobError = {
      reason: 'invalid-position',
      message: 'The position has no legal moves to analyze.',
    };
    const { result } = renderHook(() =>
      useLiveAnalysis({
        service: serviceReturning(settledJob({ kind: 'failed', error }, 'failed')),
        fen: FEN,
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.error).toEqual(error));
    expect(result.current.analyzing).toBe(false);
    expect(result.current.lines).toEqual([]);
  });

  it('surfaces the result when the job already completed before subscribe', async () => {
    const analysis: EngineAnalysisResult = {
      jobId: 'job-1',
      position: FEN,
      profile: 'normal',
      lines: [
        {
          multipv: 1,
          evaluation: { cp: 21 },
          principalVariation: [{ uci: 'e2e4' }, { uci: 'e7e5' }],
          wdl: null,
        },
      ],
      engine: {
        engineName: 'stockfish',
        engineVersion: '18.0.8',
        engineBuild: 'stockfish-18-lite',
        profile: 'normal',
      },
      timeMs: 5,
    };
    const { result } = renderHook(() =>
      useLiveAnalysis({
        service: serviceReturning(settledJob({ kind: 'completed', result: analysis }, 'completed')),
        fen: FEN,
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.result).toEqual(analysis));
    expect(result.current.analyzing).toBe(false);
    expect(result.current.lines).toHaveLength(1);
  });
});
