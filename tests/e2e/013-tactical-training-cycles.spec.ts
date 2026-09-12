import { test, expect, type Page } from '@playwright/test';

// Feature 013 end-to-end: set → cycle → solve (Feature-012 screen) → attempt
// rows → completion → results → next cycle, over the real persistence layer
// and the real UI.
//
// This spec is deliberately **engine-free and network-free**: it seeds the
// schema-v10 `puzzles`/`trainingSets` object stores directly through raw
// IndexedDB (no import, no Stockfish, no API route mock) and solves by clicking
// board squares on Feature 012's solving screen. Attempt rows and cycle status
// are asserted by raw IndexedDB reads. The two seeded puzzle rows mirror the
// deterministic domain fixtures in `src/domain/puzzle/test-support.ts`
// (`puzzleRowFixture('exchange-win')` and `('mate-one')`); the set config
// mirrors `DEFAULT_CYCLE_CONFIG` in `src/domain/training/cycleTypes.ts`.
const SET_ID = 'e2e:set';
const EXCHANGE_PUZZLE_ID = 'fixture:exchange-win:12';
const MATE_ONE_PUZZLE_ID = 'fixture:mate-one:6';

const PUZZLE_FIXTURE_NOW = 1_700_000_000_000;
const PUZZLE_GENERATOR_VERSION = 2;
const DETECTION_VERSION = 11;
const CANDIDATE_GENERATION_VERSION = 2;

interface SeedPuzzle {
  readonly sourceGameId: string;
  readonly sourcePly: number;
  readonly analysisId: string;
  readonly startingFen: string;
  readonly userMovePlayed: string;
  readonly sideToMove: 'white' | 'black';
  readonly bestMove: string;
  readonly bestPv: readonly string[];
  readonly origin: 'tactical' | 'blunder';
  readonly acceptedFirstMoves: readonly string[];
  readonly tacticalObjective: string;
  readonly difficulty: number;
  readonly puzzleGeneratorVersion: number;
  readonly detectionVersion: number;
  readonly candidateGenerationVersion: number;
  readonly createdAt: number;
}

interface SeedSet {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: 'active' | 'archived';
  readonly source: { readonly kind: 'manual' };
  readonly puzzleIds: readonly string[];
  readonly targetSize: number;
  readonly config: {
    readonly ordering: 'difficultyAsc' | 'sourcePly' | 'manual';
    readonly retryFailed: 'none' | 'endOfCycle' | 'immediate';
    readonly hints: { readonly enabledLevels: readonly number[]; readonly firstHintLevel: number };
    readonly allowSkip: boolean;
    readonly targetAccuracy: number | null;
    readonly targetSolvingTimeMs: number | null;
    readonly plannedCycles: number | null;
    readonly configVersion: number;
  };
}

// exchange-win: Rxd3 (a3d3), a one-move capture. mate-one: Qxf7# (h5f7), a
// one-move mate. Both are white-to-move, so the board orientation is white and
// the square geometry below is stable.
const EXCHANGE_PUZZLE: SeedPuzzle = {
  sourceGameId: 'fixture:exchange-win',
  sourcePly: 12,
  analysisId: 'analysis:exchange-win',
  startingFen: '4k3/8/8/8/8/R2q4/8/4K3 w - - 0 1',
  userMovePlayed: 'e1e2',
  sideToMove: 'white',
  bestMove: 'a3d3',
  bestPv: ['a3d3'],
  origin: 'tactical',
  acceptedFirstMoves: ['a3d3'],
  tacticalObjective: 'winning_material',
  difficulty: 30,
  puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
  detectionVersion: DETECTION_VERSION,
  candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
  createdAt: PUZZLE_FIXTURE_NOW,
};

const MATE_ONE_PUZZLE: SeedPuzzle = {
  sourceGameId: 'fixture:mate-one',
  sourcePly: 6,
  analysisId: 'analysis:mate-one',
  startingFen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  userMovePlayed: 'd2d3',
  sideToMove: 'white',
  bestMove: 'h5f7',
  bestPv: ['h5f7'],
  origin: 'tactical',
  acceptedFirstMoves: ['h5f7'],
  tacticalObjective: 'forcing_mate',
  difficulty: 12,
  puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
  detectionVersion: DETECTION_VERSION,
  candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
  createdAt: PUZZLE_FIXTURE_NOW,
};

const TRAINING_SET: SeedSet = {
  id: SET_ID,
  name: 'E2E tactics',
  createdAt: PUZZLE_FIXTURE_NOW,
  updatedAt: PUZZLE_FIXTURE_NOW,
  status: 'active',
  source: { kind: 'manual' },
  // Snapshot order = presentation order (the cycle snapshots stored membership).
  puzzleIds: [EXCHANGE_PUZZLE_ID, MATE_ONE_PUZZLE_ID],
  targetSize: 10,
  config: {
    ordering: 'manual',
    retryFailed: 'endOfCycle',
    hints: { enabledLevels: [1, 2, 3, 4], firstHintLevel: 2 },
    allowSkip: true,
    targetAccuracy: null,
    targetSolvingTimeMs: null,
    plannedCycles: null,
    configVersion: 1,
  },
};

/** The solution move for each seeded puzzle, as a from/to square pair. */
const SOLUTION_MOVES: Readonly<Record<string, readonly [string, string]>> = {
  [EXCHANGE_PUZZLE_ID]: ['a3', 'd3'],
  [MATE_ONE_PUZZLE_ID]: ['h5', 'f7'],
};

/** Open the live `chessremedy` database and write the seed rows. */
async function seedIndexedDb(
  page: Page,
  payload: { readonly puzzles: readonly SeedPuzzle[]; readonly sets: readonly SeedSet[] },
): Promise<void> {
  await page.evaluate(async (data) => {
    const request = indexedDB.open('chessremedy');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['puzzles', 'trainingSets'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        const puzzles = tx.objectStore('puzzles');
        const sets = tx.objectStore('trainingSets');
        for (const row of data.puzzles) {
          puzzles.put(row);
        }
        for (const row of data.sets) {
          sets.put(row);
        }
      });
    } finally {
      db.close();
    }
  }, payload);
}

/** Read every row of one object store (raw IndexedDB, no repository layer). */
async function readStore(page: Page, storeName: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(async (name) => {
    const request = indexedDB.open('chessremedy');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const tx = db.transaction(name, 'readonly');
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, storeName);
}

/**
 * Drag a piece from `from` to `to` on the white-oriented Chessground board.
 * Mirrors the proven coordinate approach in `game-analysis-review.spec.ts`.
 */
async function dragSquare(page: Page, from: string, to: string): Promise<void> {
  const host = page.getByTestId('chessground-host');
  await host.scrollIntoViewIfNeeded();
  const box = await host.boundingBox();
  if (box === null) {
    throw new Error('The Chessground board has no layout box.');
  }
  const centre = (square: string): { x: number; y: number } => {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = Number.parseInt(square[1]!, 10);
    return {
      x: box.x + ((file + 0.5) / 8) * box.width,
      y: box.y + ((8 - rank + 0.5) / 8) * box.height,
    };
  };
  const start = centre(from);
  const end = centre(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.waitForTimeout(60);
  await page.mouse.up();
}

/** Solve the currently presented puzzle and advance to the next one. */
async function solveAndAdvance(page: Page, puzzleId: string): Promise<void> {
  const [from, to] = SOLUTION_MOVES[puzzleId]!;
  await dragSquare(page, from, to);
  await expect(page.getByTestId('solve-result')).toBeVisible();
  const next = page.getByTestId('solve-next');
  await expect(next).toBeEnabled();
  await next.click();
}

test.describe('Tactical training cycles (Feature 013)', () => {
  test('set → cycle → solve → attempt rows → results → next cycle over real IndexedDB', async ({
    page,
  }) => {
    // Boot the app once so Dexie creates the schema-v10 `chessremedy` database,
    // then seed the deterministic fixtures directly into the live object stores.
    await page.goto('/training');
    await expect(page.getByTestId('training-home')).toBeVisible();
    await seedIndexedDb(page, {
      puzzles: [EXCHANGE_PUZZLE, MATE_ONE_PUZZLE],
      sets: [TRAINING_SET],
    });

    // Reload so the training home reads the seeded set.
    await page.reload();
    const card = page.getByTestId(`set-card-${SET_ID}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`set-card-count-${SET_ID}`)).toHaveText('2 puzzles');

    // Open the set and start cycle 1.
    await page.getByTestId(`set-card-open-${SET_ID}`).click();
    await expect(page.getByTestId('set-detail-name')).toHaveText('E2E tactics');
    await page.getByTestId('set-detail-start-cycle').click();

    // Cycle session chrome: the first snapshot puzzle (exchange-win).
    await expect(page.getByTestId('cycle-session-cycle-number')).toHaveText('Cycle 1');
    await expect(page.getByTestId('cycle-session-progress')).toHaveText('Puzzle 1 of 2');
    await expect(page.getByTestId('solve-screen')).toBeVisible();

    // Solve both puzzles by clicking board squares (no engine toggle).
    await solveAndAdvance(page, EXCHANGE_PUZZLE_ID);
    await expect(page.getByTestId('cycle-session-progress')).toHaveText('Puzzle 2 of 2');
    await solveAndAdvance(page, MATE_ONE_PUZZLE_ID);

    // Completion navigates to the results view.
    await expect(page.getByTestId('cycle-results-status')).toHaveText('Completed');
    await expect(page.getByTestId('cycle-results-cycle-number')).toHaveText('Cycle 1');

    // Start the next cycle from the results (repeat).
    await page.getByTestId('cycle-results-next-cycle').click();
    await expect(page.getByTestId('cycle-session-cycle-number')).toHaveText('Cycle 2');
    await expect(page.getByTestId('cycle-session-progress')).toHaveText('Puzzle 1 of 2');

    // Mobile layout: the session chrome stays reachable alongside the board.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('cycle-session-chrome')).toBeVisible();
    await expect(page.getByTestId('cycle-session-progress')).toBeVisible();
    await expect(page.getByTestId('solve-screen')).toBeVisible();

    // Raw IndexedDB proof: two immutable attempt rows for cycle 1, each a
    // first-presentation solve under the real cycle/set ids.
    const attempts = await readStore(page, 'puzzleAttempts');
    const cycle1Attempts = attempts.filter((row) => row.trainingSetId === SET_ID);
    expect(cycle1Attempts).toHaveLength(2);
    expect(cycle1Attempts.map((row) => row.puzzleId).sort()).toEqual(
      [EXCHANGE_PUZZLE_ID, MATE_ONE_PUZZLE_ID].sort(),
    );
    for (const row of cycle1Attempts) {
      expect(row.result).toBe('solvedFirstTry');
      expect(row.presentationIndex).toBe(1);
      expect(row.solved).toBe(true);
    }
    // Exactly one cycle-1 attempt per snapshot puzzle, and no practice rows.
    expect(new Set(cycle1Attempts.map((row) => row.cycleId)).size).toBe(1);
    expect(attempts.some((row) => String(row.cycleId).startsWith('practice:'))).toBe(false);

    // Raw IndexedDB proof: cycle 1 completed, cycle 2 in progress.
    const cycles = await readStore(page, 'trainingCycles');
    const setCycles = cycles
      .filter((row) => row.trainingSetId === SET_ID)
      .sort((a, b) => Number(a.cycleNumber) - Number(b.cycleNumber));
    expect(setCycles.map((row) => row.cycleNumber)).toEqual([1, 2]);
    expect(setCycles[0]!.status).toBe('completed');
    expect(setCycles[0]!.completedAt).not.toBeNull();
    expect(setCycles[1]!.status).toBe('inProgress');

    // The seeded puzzles are untouched (immutable rows).
    const puzzles = await readStore(page, 'puzzles');
    expect(puzzles).toHaveLength(2);
  });
});
