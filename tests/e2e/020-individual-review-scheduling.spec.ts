import { test, expect, type Page } from '@playwright/test';

// Feature 020 end-to-end: review card → setup → solve (Feature-012 screen) →
// attempt rows + schedule projection → summary, over the real persistence layer
// and the real UI.
//
// Engine-free and network-free: the schema-v13 `puzzles` store is seeded
// directly through raw IndexedDB (no import, no Stockfish) and puzzles are
// solved by clicking board squares. `puzzleSchedules` rows and the review
// sentinel cycle are asserted by raw IndexedDB reads.
const EXCHANGE_PUZZLE_ID = 'fixture:exchange-win:12';
const MATE_ONE_PUZZLE_ID = 'fixture:mate-one:6';
const REVIEW_SET_ID = '__review__';

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

const SOLUTION_MOVES: Readonly<Record<string, readonly [string, string]>> = {
  [EXCHANGE_PUZZLE_ID]: ['a3', 'd3'],
  [MATE_ONE_PUZZLE_ID]: ['h5', 'f7'],
};

async function seedPuzzles(page: Page, puzzles: readonly SeedPuzzle[]): Promise<void> {
  await page.evaluate(async (rows) => {
    const request = indexedDB.open('chessremedy');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['puzzles'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        const store = tx.objectStore('puzzles');
        for (const row of rows) {
          store.put(row);
        }
      });
    } finally {
      db.close();
    }
  }, puzzles);
}

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

async function solveAndAdvance(page: Page, puzzleId: string): Promise<void> {
  const [from, to] = SOLUTION_MOVES[puzzleId]!;
  await dragSquare(page, from, to);
  await expect(page.getByTestId('solve-result')).toBeVisible();
  const next = page.getByTestId('solve-next');
  await expect(next).toBeEnabled();
  await next.click();
}

test.describe('Individual review scheduling (Feature 020)', () => {
  test('card → setup → solve → schedule projection → summary', async ({ page }) => {
    await page.goto('/training');
    await expect(page.getByTestId('training-home')).toBeVisible();
    await seedPuzzles(page, [EXCHANGE_PUZZLE, MATE_ONE_PUZZLE]);

    await page.reload();
    const card = page.getByTestId('review-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('review-new')).toHaveText('2');
    await expect(card.getByTestId('review-start')).toHaveAttribute('aria-disabled', 'false');

    await card.getByTestId('review-start').click();
    await expect(page.getByTestId('review-setup-due')).toHaveText('0');
    await expect(page.getByTestId('review-setup-new')).toHaveText('2');

    await page.getByTestId('session-begin').click();
    await expect(page.getByTestId('review-session-progress')).toHaveText('Puzzle 1 of 2');

    // New intake is difficulty-ascending, so the mate-one puzzle (difficulty
    // 12) is presented before the exchange puzzle (30).
    await solveAndAdvance(page, MATE_ONE_PUZZLE_ID);
    // A polite next-review announcement is surfaced after a definite outcome.
    await expect(page.getByTestId('review-announcement')).not.toHaveText('');
    await expect(page.getByTestId('review-session-progress')).toHaveText('Puzzle 2 of 2');
    await solveAndAdvance(page, EXCHANGE_PUZZLE_ID);

    await expect(page.getByTestId('session-summary')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review summary' })).toBeVisible();
    await expect(page.getByTestId('review-summary-retention')).toBeVisible();
    await expect(page.getByTestId('review-summary-introduced')).toHaveText('2');

    // Raw IndexedDB proof: one schedule row per solved puzzle.
    const schedules = await readStore(page, 'puzzleSchedules');
    expect(schedules.map((row) => row.puzzleId).sort()).toEqual(
      [EXCHANGE_PUZZLE_ID, MATE_ONE_PUZZLE_ID].sort(),
    );
    for (const row of schedules) {
      expect(['easy', 'good']).toContain(row.lastGrade);
    }

    // Raw IndexedDB proof: a review-sentinel cycle with no retry.
    const cycles = await readStore(page, 'trainingCycles');
    const reviewCycles = cycles.filter((row) => row.trainingSetId === REVIEW_SET_ID);
    expect(reviewCycles).toHaveLength(1);
    expect(reviewCycles[0]!.config).toMatchObject({ retryFailed: 'none' });

    // Mobile layout: the review card and session chrome stay reachable.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('session-summary')).toBeVisible();
  });

  test('shows the explicit empty state when nothing is scheduled', async ({ page }) => {
    await page.goto('/training');
    const card = page.getByTestId('review-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('review-empty')).toContainText('All caught up');
    await expect(card.getByTestId('review-start')).toHaveAttribute('aria-disabled', 'true');
    await expect(card.getByTestId('review-start-note')).toBeVisible();
  });
});
