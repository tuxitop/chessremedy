import { test, expect, type Page } from '@playwright/test';

// Feature 013 end-to-end: the two system auto sets, their live (derived)
// membership, mastery retirement and the refreshed stored snapshot, over the
// real persistence layer and the real UI.
//
// Deliberately **engine-free and network-free**: the schema-v10 `puzzles` and
// `puzzleAttempts` stores are seeded directly through raw IndexedDB (no import,
// no Stockfish, no API route mock) and the auto sets themselves are seeded
// idempotently by the app on the first `/puzzles` boot (`ensureAutoSets`).
// Reads are raw IndexedDB, mirroring `013-tactical-training-cycles.spec.ts`.
//
// The seeded puzzle rows mirror the deterministic domain fixtures in
// `src/domain/puzzle/test-support.ts` (three rows with distinct difficulties:
// `mate-one` 12, `exchange-win` 30, `material-combination` 48). The auto-set ids
// mirror `src/domain/training/autoSet.ts` (`AUTO_SET_ALL_ID`,
// `AUTO_SET_RANDOM_ID`) and the mastery rule mirrors
// `src/domain/training/mastery.ts` (a legitimate first-try solve — first
// presentation, `solvedFirstTry`, no hint/wrong move/restart — in 3 distinct
// cycles).
const AUTO_SET_ALL_ID = 'auto:all-puzzles';
const AUTO_SET_RANDOM_ID = 'auto:woodpecker-random';

const MATE_ONE_PUZZLE_ID = 'fixture:mate-one:6';
const EXCHANGE_PUZZLE_ID = 'fixture:exchange-win:12';
const MATERIAL_COMBINATION_PUZZLE_ID = 'fixture:material-combination:8';

const PUZZLE_FIXTURE_NOW = 1_700_000_000_000;
const PUZZLE_GENERATOR_VERSION = 2;
const DETECTION_VERSION = 10;
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

interface SeedAttempt {
  readonly puzzleId: string;
  readonly trainingSetId: string;
  readonly cycleId: string;
  readonly presentationIndex: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly result: string;
  readonly solvingTimeMs: number;
  readonly wrongMoveCount: number;
  readonly hintCount: number;
  readonly highestHintLevel: number | null;
  readonly restartCount: number;
  readonly solved: boolean;
  readonly puzzleGeneratorVersion: number;
  readonly origin: 'tactical' | 'blunder';
}

// Three rows mirroring `puzzleRowFixture(...)`: distinct difficulties so the
// derived `difficultyAsc` order is stable and easy to assert.
const MATE_ONE: SeedPuzzle = {
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

const EXCHANGE_WIN: SeedPuzzle = {
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

const MATERIAL_COMBINATION: SeedPuzzle = {
  sourceGameId: 'fixture:material-combination',
  sourcePly: 8,
  analysisId: 'analysis:material-combination',
  startingFen: 'r1bqkb1r/pppp1pp1/2n2n1p/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5',
  userMovePlayed: 'g2g3',
  sideToMove: 'white',
  bestMove: 'g5f7',
  bestPv: ['g5f7', 'd8e7', 'f7h8'],
  origin: 'tactical',
  acceptedFirstMoves: ['g5f7'],
  tacticalObjective: 'winning_material',
  difficulty: 48,
  puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
  detectionVersion: DETECTION_VERSION,
  candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
  createdAt: PUZZLE_FIXTURE_NOW,
};

/**
 * Three legitimate first-try attempt rows for `puzzleId` in distinct cycles —
 * the mastery rule's 3-distinct-cycle credit (`mastery.ts`). `trainingSetId` is
 * a real auto-set id; mastery derivation itself ignores it.
 */
function masteryAttempts(puzzleId: string, cycleIds: readonly string[]): SeedAttempt[] {
  return cycleIds.map((cycleId, index) => {
    const startedAt = PUZZLE_FIXTURE_NOW + index * 10_000;
    return {
      puzzleId,
      trainingSetId: AUTO_SET_ALL_ID,
      cycleId,
      presentationIndex: 1,
      startedAt,
      endedAt: startedAt + 5_000,
      result: 'solvedFirstTry',
      solvingTimeMs: 5_000,
      wrongMoveCount: 0,
      hintCount: 0,
      highestHintLevel: null,
      restartCount: 0,
      solved: true,
      puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
      origin: 'tactical',
    };
  });
}

/** Open the live `chessremedy` database and write the seed rows. */
async function seedIndexedDb(
  page: Page,
  payload: {
    readonly puzzles?: readonly SeedPuzzle[];
    readonly attempts?: readonly SeedAttempt[];
  },
): Promise<void> {
  await page.evaluate(async (data) => {
    const request = indexedDB.open('chessremedy');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['puzzles', 'puzzleAttempts'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        const puzzles = tx.objectStore('puzzles');
        const attempts = tx.objectStore('puzzleAttempts');
        for (const row of data.puzzles ?? []) {
          puzzles.put(row);
        }
        for (const row of data.attempts ?? []) {
          attempts.put(row);
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

test.describe('Auto-generated sets and mastery (Feature 013)', () => {
  test('the two system auto sets exist by default and derive their count from the live pool', async ({
    page,
  }) => {
    // Fresh boot: Dexie creates schema v10 and the training home seeds both auto
    // sets idempotently. With an empty pool the home shows the explicit
    // "generate puzzles first" empty state (spec §1) — the auto-set cards need a
    // non-empty pool to render, so existence is proven at the row level first.
    await page.goto('/puzzles');
    await expect(page.getByTestId('training-home')).toBeVisible();
    await expect(page.getByTestId('training-home-empty')).toBeVisible();

    const seededSets = await readStore(page, 'trainingSets');
    const byId = new Map(seededSets.map((row) => [row.id, row]));
    for (const id of [AUTO_SET_ALL_ID, AUTO_SET_RANDOM_ID]) {
      const row = byId.get(id);
      expect(row, `auto set ${id} should be seeded on a fresh boot`).toBeDefined();
      expect((row!.source as { kind?: string }).kind).toBe('auto');
    }

    // Seed one deterministic puzzle; the auto sets now render with the real ids,
    // an Auto badge and a derived count.
    await seedIndexedDb(page, { puzzles: [MATE_ONE] });
    await page.reload();
    for (const id of [AUTO_SET_ALL_ID, AUTO_SET_RANDOM_ID]) {
      await expect(page.getByTestId(`set-card-${id}`)).toBeVisible();
      await expect(page.getByTestId(`set-card-badge-${id}`)).toHaveText('Auto');
      await expect(page.getByTestId(`set-card-count-${id}`)).toHaveText('1 puzzle');
    }

    // The count is derived live, not from the stored snapshot: two more puzzles
    // join the pool and both auto sets report 3.
    await seedIndexedDb(page, { puzzles: [EXCHANGE_WIN, MATERIAL_COMBINATION] });
    await page.reload();
    for (const id of [AUTO_SET_ALL_ID, AUTO_SET_RANDOM_ID]) {
      await expect(page.getByTestId(`set-card-count-${id}`)).toHaveText('3 puzzles');
    }
  });

  test('mastery retires a puzzle from the auto sets, the mastered list and the next cycle', async ({
    page,
  }) => {
    await page.goto('/puzzles');
    await expect(page.getByTestId('training-home')).toBeVisible();
    await expect(page.getByTestId('training-home-empty')).toBeVisible();

    // Seed the pool and mark `mate-one` mastered across 3 distinct cycles (a real
    // `trainingSetId`, first presentation, clean first-try solve).
    await seedIndexedDb(page, {
      puzzles: [MATE_ONE, EXCHANGE_WIN, MATERIAL_COMBINATION],
      attempts: masteryAttempts(MATE_ONE_PUZZLE_ID, [
        'e2e:mastery-cycle-1',
        'e2e:mastery-cycle-2',
        'e2e:mastery-cycle-3',
      ]),
    });

    await page.reload();

    // (b) The auto-set derived count excludes the mastered puzzle: 3 − 1 = 2.
    await expect(page.getByTestId(`set-card-count-${AUTO_SET_ALL_ID}`)).toHaveText('2 puzzles');
    await expect(page.getByTestId(`set-card-count-${AUTO_SET_RANDOM_ID}`)).toHaveText('2 puzzles');

    // (a) The read-only mastered list names only the mastered puzzle.
    await page.getByTestId('training-mastered-link').click();
    await expect(page.getByTestId('mastered-puzzles')).toBeVisible();
    await expect(page.getByTestId(`mastered-puzzle-${MATE_ONE_PUZZLE_ID}`)).toBeVisible();
    await expect(page.getByTestId(`mastered-puzzle-cycles-${MATE_ONE_PUZZLE_ID}`)).toHaveText(
      '3 distinct cycles',
    );
    await expect(page.getByTestId(`mastered-puzzle-${EXCHANGE_PUZZLE_ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`mastered-puzzle-${MATERIAL_COMBINATION_PUZZLE_ID}`)).toHaveCount(
      0,
    );

    // Start a cycle on the all-puzzles auto set: the snapshot total is the
    // unmastered pool (2), the mastered puzzle excluded.
    await page.goto('/puzzles');
    await page.getByTestId(`set-card-open-${AUTO_SET_ALL_ID}`).click();
    await expect(page.getByTestId('set-detail-name')).toContainText('All puzzles');
    await expect(page.getByTestId('set-detail-auto-badge')).toHaveText('Auto');
    await page.getByTestId('set-detail-start-cycle').click();
    await expect(page.getByTestId('cycle-session-progress')).toHaveText('Puzzle 1 of 2');

    // The stored auto set row was refreshed to the derived membership at start
    // (difficulty ascending: exchange-win 30, material-combination 48).
    const sets = await readStore(page, 'trainingSets');
    const all = sets.find((row) => row.id === AUTO_SET_ALL_ID);
    expect(all?.puzzleIds).toEqual([EXCHANGE_PUZZLE_ID, MATERIAL_COMBINATION_PUZZLE_ID]);
  });
});
