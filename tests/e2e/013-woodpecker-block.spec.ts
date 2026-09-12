import { test, expect, type Page } from '@playwright/test';

// Feature 013 end-to-end: the explicit Woodpecker block model (spec
// §1/§3a/§3b/§3c) — the derived pool, the one-click fixed block, the read-only
// mastered list, the close/return-to-pool lifecycle and Quick train — over the
// real persistence layer and the real UI.
//
// Deliberately **engine-free and network-free**: the schema-v10 `puzzles`,
// `puzzleAttempts`, `trainingSets` and `trainingCycles` stores are seeded
// directly through raw IndexedDB (no import, no Stockfish, no API route mock)
// and the block is formed by the real one-click UI action. Reads are raw
// IndexedDB, mirroring `013-tactical-training-cycles.spec.ts`.
//
// The seeded puzzle rows mirror the deterministic domain fixtures in
// `src/domain/puzzle/test-support.ts` (`mate-one` 12, `exchange-win` 30,
// `material-combination` 48). The mastery rule mirrors
// `src/domain/training/mastery.ts` (a legitimate first-try solve — first
// presentation, `solvedFirstTry`, no hint/wrong move/restart — in 3 distinct
// cycles) and block formation mirrors `src/domain/training/autoSet.ts`
// (difficulty ascending, ties by `sourcePly` then `puzzleId`).
const MATE_ONE_PUZZLE_ID = 'fixture:mate-one:6';
const EXCHANGE_PUZZLE_ID = 'fixture:exchange-win:12';
const MATERIAL_COMBINATION_PUZZLE_ID = 'fixture:material-combination:8';

const QUICK_TRAIN_SET_ID = '__quick_train__';
const MASTERY_SET_ID = 'e2e:mastery-set';

// Feature-013 W4: the deterministic pre-block-model auto-set ids the one-time
// startup cleanup removes, its settings guard, and the unrelated data the tests
// assert survives the delete/cleanup cascades.
const LEGACY_AUTO_SET_IDS = ['auto:all-puzzles', 'auto:woodpecker-random'] as const;
const LEGACY_CLEANUP_MARKER_KEY = 'training.legacyAutoSetsCleaned';
const OTHER_SET_ID = 'e2e:other-set';
const KEEP_BLOCK_ID = 'e2e:keep-block';

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

interface SeedCycle {
  readonly id: string;
  readonly trainingSetId: string;
  readonly cycleNumber: number;
  readonly status: string;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly abandonedAt: number | null;
  readonly puzzleIds: readonly string[];
  readonly config: typeof MASTERY_CONFIG;
  readonly cycleMetricsVersion: number;
}

// The persisted `source` variants the raw-IDB seeding needs: a custom set
// (`manual`), a real Woodpecker block (`auto` + `woodpeckerBlock` recipe) and
// the untrusted pre-block-model legacy row (`auto` with no recipe).
type SeedSetSource =
  | { readonly kind: 'manual' }
  | { readonly kind: 'auto'; readonly recipe?: { readonly kind: string; readonly size: number } };

interface SeedSet {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: 'active' | 'archived';
  readonly source: SeedSetSource;
  readonly puzzleIds: readonly string[];
  readonly targetSize: number;
  readonly config: typeof MASTERY_CONFIG;
}

// A valid persisted cycle config, mirroring `DEFAULT_CYCLE_CONFIG`. The seeded
// cycles exist so the mastery credits are anchored to real `trainingCycles`
// rows (spec §3b: "a real `trainingCycles` row"), not orphaned attempts.
const MASTERY_CONFIG = {
  ordering: 'difficultyAsc',
  retryFailed: 'endOfCycle',
  hints: { enabledLevels: [1, 2, 3, 4], firstHintLevel: 2 },
  allowSkip: true,
  targetAccuracy: null,
  targetSolvingTimeMs: null,
  plannedCycles: null,
  configVersion: 1,
} as const;

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

// A new, easier puzzle generated after the block is open: the pool grows but a
// frozen block must not absorb it.
const EASIER_PUZZLE: SeedPuzzle = {
  sourceGameId: 'fixture:easier',
  sourcePly: 4,
  analysisId: 'analysis:easier',
  startingFen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
  userMovePlayed: 'e1e2',
  sideToMove: 'white',
  bestMove: 'h1h8',
  bestPv: ['h1h8'],
  origin: 'tactical',
  acceptedFirstMoves: ['h1h8'],
  tacticalObjective: 'winning_material',
  difficulty: 5,
  puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
  detectionVersion: DETECTION_VERSION,
  candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
  createdAt: PUZZLE_FIXTURE_NOW,
};

/** The solution move for each seeded puzzle, as a from/to square pair. */
const SOLUTION_MOVES: Readonly<Record<string, readonly [string, string]>> = {
  [MATE_ONE_PUZZLE_ID]: ['h5', 'f7'],
};

/**
 * Legitimate first-try attempt rows for `puzzleId` in distinct cycles — the
 * mastery rule's 3-distinct-cycle credit (`mastery.ts`). The training set id is
 * an arbitrary real id; the mastery derivation keys on `puzzleId`/`cycleId`.
 */
function masteryAttempts(puzzleId: string, cycleIds: readonly string[]): SeedAttempt[] {
  return cycleIds.map((cycleId, index) => {
    const startedAt = PUZZLE_FIXTURE_NOW + index * 10_000;
    return {
      puzzleId,
      trainingSetId: MASTERY_SET_ID,
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

/**
 * The real `trainingCycles` rows backing `masteryAttempts`: one completed cycle
 * per supplied id, so each credit is anchored to a persisted cycle (spec §3b).
 */
function masteryCycles(puzzleId: string, cycleIds: readonly string[]): SeedCycle[] {
  return cycleIds.map((id, index) => ({
    id,
    trainingSetId: MASTERY_SET_ID,
    cycleNumber: index + 1,
    status: 'completed',
    startedAt: PUZZLE_FIXTURE_NOW + index * 10_000,
    completedAt: PUZZLE_FIXTURE_NOW + index * 10_000 + 5_000,
    abandonedAt: null,
    puzzleIds: [puzzleId],
    config: MASTERY_CONFIG,
    cycleMetricsVersion: 1,
  }));
}

/** A deterministic completed cycle row for a set's first cycle. */
function completedCycle(
  id: string,
  trainingSetId: string,
  puzzleIds: readonly string[],
  offset = 0,
): SeedCycle {
  const startedAt = PUZZLE_FIXTURE_NOW + offset;
  return {
    id,
    trainingSetId,
    cycleNumber: 1,
    status: 'completed',
    startedAt,
    completedAt: startedAt + 5_000,
    abandonedAt: null,
    puzzleIds: [...puzzleIds],
    config: MASTERY_CONFIG,
    cycleMetricsVersion: 1,
  };
}

/** A deterministic clean first-try attempt row for a puzzle under a set/cycle. */
function cleanAttempt(
  puzzleId: string,
  trainingSetId: string,
  cycleId: string,
  offset = 0,
): SeedAttempt {
  const startedAt = PUZZLE_FIXTURE_NOW + offset;
  return {
    puzzleId,
    trainingSetId,
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
}

/** Open the live `chessremedy` database and write the seed rows. */
async function seedIndexedDb(
  page: Page,
  payload: {
    readonly puzzles?: readonly SeedPuzzle[];
    readonly attempts?: readonly SeedAttempt[];
    readonly cycles?: readonly SeedCycle[];
    readonly sets?: readonly SeedSet[];
    /**
     * Remove the `training.legacyAutoSetsCleaned` settings marker in the same
     * transaction. A fresh boot writes the marker, so the legacy-cleanup test
     * clears it to simulate an upgrade that already holds legacy rows.
     */
    readonly removeLegacyAutoSetsMarker?: boolean;
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
        const tx = db.transaction(
          ['puzzles', 'puzzleAttempts', 'trainingCycles', 'trainingSets', 'settings'],
          'readwrite',
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        const puzzles = tx.objectStore('puzzles');
        const attempts = tx.objectStore('puzzleAttempts');
        const cycles = tx.objectStore('trainingCycles');
        const sets = tx.objectStore('trainingSets');
        for (const row of data.puzzles ?? []) {
          puzzles.put(row);
        }
        for (const row of data.attempts ?? []) {
          attempts.put(row);
        }
        for (const row of data.cycles ?? []) {
          cycles.put(row);
        }
        for (const row of data.sets ?? []) {
          sets.put(row);
        }
        if (data.removeLegacyAutoSetsMarker) {
          tx.objectStore('settings').delete('training.legacyAutoSetsCleaned');
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

/** The one open Woodpecker block (`source.kind === 'auto'`), from raw IndexedDB. */
async function readOpenBlock(page: Page): Promise<Record<string, unknown> | undefined> {
  const sets = await readStore(page, 'trainingSets');
  return sets.find((row) => (row.source as { kind?: string }).kind === 'auto');
}

/** The block id from a `/training/sets/:setId` URL. */
function blockIdFromUrl(page: Page): string {
  return new URL(page.url()).pathname.split('/training/sets/')[1]!.split('/')[0]!;
}

/**
 * Drag a piece from `from` to `to` on the white-oriented Chessground board.
 * Mirrors the proven coordinate approach in `013-tactical-training-cycles.spec.ts`.
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

test.describe('Woodpecker blocks, pool and Quick train (Feature 013)', () => {
  test('the pool forms a one-click block whose membership is frozen and snapshotted by the cycle', async ({
    page,
  }) => {
    // Fresh boot creates schema v10; with no puzzles the explicit empty state
    // shows and no block is ever formed automatically.
    await page.goto('/training');
    await expect(page.getByTestId('training-home')).toBeVisible();
    await expect(page.getByTestId('training-home-empty')).toBeVisible();

    await seedIndexedDb(page, { puzzles: [MATE_ONE, EXCHANGE_WIN, MATERIAL_COMBINATION] });
    await page.reload();

    // The pool card: live count and the guidance copy (spec §1/§3a).
    await expect(page.getByTestId('training-pool')).toBeVisible();
    await expect(page.getByTestId('training-pool-count')).toHaveText('3 puzzles ready to train');
    await expect(page.getByTestId('training-pool-guidance')).toContainText(
      'A block is fixed once created',
    );
    await expect(page.getByTestId('training-pool-guidance')).toContainText('200–400');

    // One click at the default size 200 → the block takes the whole small pool.
    await page.getByTestId('training-block-create').click();
    await expect(page.getByTestId('set-detail-block-badge')).toHaveText('Woodpecker block');
    await expect(page.getByTestId('set-detail-name')).toContainText('Woodpecker block');
    await expect(page.getByTestId('set-detail-membership-count')).toHaveText(
      '3 puzzles in this block (fixed).',
    );

    const blockId = blockIdFromUrl(page);
    const block = await readOpenBlock(page);
    expect(block?.id).toBe(blockId);
    expect(block?.status).toBe('active');
    expect((block?.source as { recipe?: { size?: number } }).recipe?.size).toBe(200);
    // Easy→hard: difficulty 12, 30, 48.
    expect(block?.puzzleIds).toEqual([
      MATE_ONE_PUZZLE_ID,
      EXCHANGE_PUZZLE_ID,
      MATERIAL_COMBINATION_PUZZLE_ID,
    ]);

    // Frozen membership: a new, easier pool puzzle does not join the open block.
    await seedIndexedDb(page, { puzzles: [EASIER_PUZZLE] });
    await page.goto('/training');
    await expect(page.getByTestId('training-block-open-note')).toBeVisible();
    await expect(page.getByTestId(`set-card-count-${blockId}`)).toHaveText('3 puzzles');
    await expect(page.getByTestId('training-pool-count')).toHaveText('1 puzzle ready to train');
    await expect(page.getByTestId('training-block-create')).toHaveCount(0);

    // Starting a cycle snapshots the frozen block membership, not the pool.
    await page.getByTestId(`set-card-open-${blockId}`).click();
    await page.getByTestId('set-detail-start-cycle').click();
    await expect(page.getByTestId('cycle-session-progress')).toHaveText('Puzzle 1 of 3');

    const cycles = await readStore(page, 'trainingCycles');
    const cycle = cycles.find((row) => row.trainingSetId === blockId);
    expect(cycle?.status).toBe('inProgress');
    expect(cycle?.cycleNumber).toBe(1);
    expect(cycle?.puzzleIds).toEqual([
      MATE_ONE_PUZZLE_ID,
      EXCHANGE_PUZZLE_ID,
      MATERIAL_COMBINATION_PUZZLE_ID,
    ]);
  });

  test('a mastered puzzle leaves the pool, is listed on /training/mastered and is excluded from a block', async ({
    page,
  }) => {
    await page.goto('/training');
    await expect(page.getByTestId('training-home-empty')).toBeVisible();

    // `mate-one` earns mastery across 3 distinct cycles.
    const masteryCycleIds = ['e2e:mastery-cycle-1', 'e2e:mastery-cycle-2', 'e2e:mastery-cycle-3'];
    await seedIndexedDb(page, {
      puzzles: [MATE_ONE, EXCHANGE_WIN, MATERIAL_COMBINATION],
      attempts: masteryAttempts(MATE_ONE_PUZZLE_ID, masteryCycleIds),
      cycles: masteryCycles(MATE_ONE_PUZZLE_ID, masteryCycleIds),
    });
    await page.reload();

    // The mastered puzzle is outside the derived pool: 3 − 1 = 2.
    await expect(page.getByTestId('training-pool-count')).toHaveText('2 puzzles ready to train');

    // The read-only mastered list names only the mastered puzzle.
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

    // The block form selects only the remaining pool (mastery excluded).
    await page.goto('/training');
    await page.getByTestId('training-block-create').click();
    await expect(page.getByTestId('set-detail-membership-count')).toHaveText(
      '2 puzzles in this block (fixed).',
    );
    const block = await readOpenBlock(page);
    expect(block?.puzzleIds).toEqual([EXCHANGE_PUZZLE_ID, MATERIAL_COMBINATION_PUZZLE_ID]);
  });

  test('finishing a block returns its still-unmastered members to the pool and allows the next block', async ({
    page,
  }) => {
    await page.goto('/training');
    await expect(page.getByTestId('training-home-empty')).toBeVisible();
    await seedIndexedDb(page, { puzzles: [MATE_ONE, EXCHANGE_WIN, MATERIAL_COMBINATION] });
    await page.reload();

    await page.getByTestId('training-block-create').click();
    await expect(page.getByTestId('set-detail-block-badge')).toHaveText('Woodpecker block');
    const blockId = blockIdFromUrl(page);
    await expect(page.getByTestId('set-detail-finish-block')).toBeVisible();

    // Finish block → explicit confirmation → the block closes (archived).
    await page.getByTestId('set-detail-finish-block').click();
    await expect(page.getByTestId('set-detail-close-dialog')).toBeVisible();
    await page.getByTestId('set-detail-close-dialog-confirm').click();
    await expect(page.getByTestId('set-detail-notice')).toContainText('Block finished');
    await expect(page.getByTestId('set-detail-block-closed')).toBeVisible();

    const closed = (await readStore(page, 'trainingSets')).find((row) => row.id === blockId);
    expect(closed?.status).toBe('archived');

    // Back home the members are pool-eligible again and the create action returns.
    await page.goto('/training');
    await expect(page.getByTestId('training-pool-count')).toHaveText('3 puzzles ready to train');
    await expect(page.getByTestId('training-block-open-note')).toHaveCount(0);
    await page.getByTestId('training-block-create').click();

    // A second, distinct block is formed over the returned pool.
    await expect(page.getByTestId('set-detail-block-badge')).toHaveText('Woodpecker block');
    const blocks = (await readStore(page, 'trainingSets')).filter(
      (row) => (row.source as { kind?: string }).kind === 'auto',
    );
    expect(blocks).toHaveLength(2);
    const active = blocks.filter((row) => row.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0]?.id).not.toBe(blockId);
    expect(active[0]?.puzzleIds).toEqual([
      MATE_ONE_PUZZLE_ID,
      EXCHANGE_PUZZLE_ID,
      MATERIAL_COMBINATION_PUZZLE_ID,
    ]);
  });

  test('Quick train resumes the open sentinel session and its attempts never count toward mastery', async ({
    page,
  }) => {
    await page.goto('/training');
    await expect(page.getByTestId('training-home-empty')).toBeVisible();

    // Two real clean credits, not three: `mate-one` is still in the pool. The
    // Quick-train sentinel solve below must not supply the third.
    const seededCycleIds = ['e2e:qt-seed-1', 'e2e:qt-seed-2'];
    await seedIndexedDb(page, {
      puzzles: [MATE_ONE, EXCHANGE_WIN, MATERIAL_COMBINATION],
      attempts: masteryAttempts(MATE_ONE_PUZZLE_ID, seededCycleIds),
      cycles: masteryCycles(MATE_ONE_PUZZLE_ID, seededCycleIds),
    });
    await page.reload();
    await expect(page.getByTestId('training-pool-count')).toHaveText('3 puzzles ready to train');

    // Quick train creates no set row; it opens an ad-hoc session over the pool.
    await page.getByTestId('training-quick-train').click();
    await expect(page.getByTestId('cycle-session-set-name')).toHaveText('Quick train');
    await expect(page.getByTestId('cycle-session-cycle-number')).toHaveText('Quick train');
    await expect(page.getByTestId('cycle-session-progress')).toHaveText('Puzzle 1 of 3');

    await solveAndAdvance(page, MATE_ONE_PUZZLE_ID);
    await expect(page.getByTestId('cycle-session-progress')).toHaveText('Puzzle 2 of 3');

    // Raw IDB: a real cycle under the sentinel, no `trainingSets` row.
    const cycles = await readStore(page, 'trainingCycles');
    const quickCycles = cycles.filter((row) => row.trainingSetId === QUICK_TRAIN_SET_ID);
    expect(quickCycles).toHaveLength(1);
    const quick = quickCycles[0]!;
    expect(quick.status).toBe('inProgress');
    expect(quick.puzzleIds).toEqual([
      MATE_ONE_PUZZLE_ID,
      EXCHANGE_PUZZLE_ID,
      MATERIAL_COMBINATION_PUZZLE_ID,
    ]);
    expect(
      (await readStore(page, 'trainingSets')).some((row) => row.id === QUICK_TRAIN_SET_ID),
    ).toBe(false);

    // The attempt is a real, immutable, legitimate first-try row under the cycle.
    const attempts = await readStore(page, 'puzzleAttempts');
    const row = attempts.find(
      (attempt) =>
        attempt.trainingSetId === QUICK_TRAIN_SET_ID && attempt.puzzleId === MATE_ONE_PUZZLE_ID,
    );
    expect(row?.cycleId).toBe(quick.id);
    expect(row?.result).toBe('solvedFirstTry');
    expect(row?.presentationIndex).toBe(1);
    expect(row?.hintCount).toBe(0);
    expect(row?.wrongMoveCount).toBe(0);
    expect(row?.restartCount).toBe(0);
    expect(row?.solved).toBe(true);
    // No practice pseudo-ids remain: every attempt belongs to a real cycle row.
    expect(attempts.some((attempt) => String(attempt.cycleId).startsWith('practice:'))).toBe(false);

    // Leaving and tapping Quick train again RESUMES the open sentinel cycle: the
    // same cycle row continues at the next unanswered puzzle (no new cycle).
    await page.goto('/training');
    await expect(page.getByTestId('training-quick-train')).toBeEnabled();
    await page.getByTestId('training-quick-train').click();
    await expect(page.getByTestId('cycle-session-cycle-number')).toHaveText('Quick train');
    await expect(page.getByTestId('cycle-session-progress')).toHaveText('Puzzle 2 of 3');

    const resumedCycles = (await readStore(page, 'trainingCycles')).filter(
      (cycle) => cycle.trainingSetId === QUICK_TRAIN_SET_ID,
    );
    expect(resumedCycles).toHaveLength(1);
    expect(resumedCycles[0]!.id).toBe(quick.id);
    expect(resumedCycles[0]!.status).toBe('inProgress');

    // Quick-train attempts do not count toward mastery: despite the legitimate
    // first-try row, the puzzle stays off the mastered list.
    await page.goto('/training/mastered');
    await expect(page.getByTestId(`mastered-puzzle-${MATE_ONE_PUZZLE_ID}`)).toHaveCount(0);
  });

  test('deletes an open block from its detail page and frees the slot', async ({ page }) => {
    await page.goto('/training');
    await expect(page.getByTestId('training-home-empty')).toBeVisible();

    // An unrelated custom set (with its own attempt) proves the cascade is
    // scoped to the deleted block.
    const otherSet: SeedSet = {
      id: OTHER_SET_ID,
      name: 'Other set',
      createdAt: PUZZLE_FIXTURE_NOW,
      updatedAt: PUZZLE_FIXTURE_NOW,
      status: 'active',
      source: { kind: 'manual' },
      puzzleIds: [MATERIAL_COMBINATION_PUZZLE_ID],
      targetSize: 10,
      config: MASTERY_CONFIG,
    };
    await seedIndexedDb(page, {
      puzzles: [MATE_ONE, EXCHANGE_WIN, MATERIAL_COMBINATION],
      sets: [otherSet],
    });
    await page.reload();

    // Create the block through the real one-click action.
    await page.getByTestId('training-block-create').click();
    await expect(page.getByTestId('set-detail-block-badge')).toHaveText('Woodpecker block');
    const blockId = blockIdFromUrl(page);

    // Seed a real cycle + attempt under the created block so the confirmation
    // has counts and the delete has a cascade to perform.
    const blockCycle = completedCycle('e2e:block-cycle', blockId, [MATE_ONE_PUZZLE_ID]);
    await seedIndexedDb(page, {
      cycles: [blockCycle],
      attempts: [
        cleanAttempt(MATE_ONE_PUZZLE_ID, blockId, blockCycle.id),
        cleanAttempt(MATERIAL_COMBINATION_PUZZLE_ID, OTHER_SET_ID, 'e2e:other-cycle'),
      ],
    });

    await page.goto(`/training/sets/${blockId}`);
    await expect(page.getByTestId('set-detail-block-badge')).toHaveText('Woodpecker block');

    await page.getByTestId('set-detail-delete-block').click();
    const dialog = page.getByTestId('set-detail-delete-block-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Woodpecker block');
    const details = page.getByTestId('set-detail-delete-block-dialog-details');
    await expect(details).toContainText('1 cycle');
    await expect(details).toContainText('1 recorded attempt');
    await page.getByTestId('set-detail-delete-block-dialog-confirm').click();

    // Delete navigates home and frees the single open-block slot. (Finish and
    // Abandon are asserted to archive — not delete — by the earlier
    // "finishing a block returns its still-unmastered members" test.)
    await expect(page.getByTestId('training-home')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/training');
    await expect(page.getByTestId('training-block-create')).toBeVisible();

    // Raw IDB: the block row, its cycle and its attempt are gone.
    const sets = await readStore(page, 'trainingSets');
    expect(sets.some((row) => row.id === blockId)).toBe(false);
    const cycles = await readStore(page, 'trainingCycles');
    expect(cycles.some((row) => row.trainingSetId === blockId)).toBe(false);
    const attempts = await readStore(page, 'puzzleAttempts');
    expect(attempts.some((row) => row.trainingSetId === blockId)).toBe(false);

    // The other set, its attempt and every puzzle survive untouched.
    expect(sets.some((row) => row.id === OTHER_SET_ID)).toBe(true);
    expect(attempts.some((row) => row.trainingSetId === OTHER_SET_ID)).toBe(true);
    expect((await readStore(page, 'puzzles')).length).toBe(3);
  });

  test('removes seeded legacy auto sets on reload before the training home renders', async ({
    page,
  }) => {
    // A fresh boot writes the cleanup marker; the test then clears it to
    // simulate an upgrade that already holds legacy rows.
    await page.goto('/training');
    await expect(page.getByTestId('training-home-empty')).toBeVisible();

    const legacySets: SeedSet[] = LEGACY_AUTO_SET_IDS.map((id, index) => ({
      id,
      name: `Legacy auto set ${index + 1}`,
      createdAt: PUZZLE_FIXTURE_NOW,
      updatedAt: PUZZLE_FIXTURE_NOW,
      status: 'active',
      source: { kind: 'auto' },
      puzzleIds: [MATE_ONE_PUZZLE_ID],
      targetSize: 10,
      config: MASTERY_CONFIG,
    }));
    const keepSet: SeedSet = {
      id: OTHER_SET_ID,
      name: 'Kept set',
      createdAt: PUZZLE_FIXTURE_NOW,
      updatedAt: PUZZLE_FIXTURE_NOW,
      status: 'active',
      source: { kind: 'manual' },
      puzzleIds: [EXCHANGE_PUZZLE_ID],
      targetSize: 10,
      config: MASTERY_CONFIG,
    };
    const keepBlock: SeedSet = {
      id: KEEP_BLOCK_ID,
      name: 'Kept block',
      createdAt: PUZZLE_FIXTURE_NOW,
      updatedAt: PUZZLE_FIXTURE_NOW,
      status: 'active',
      source: { kind: 'auto', recipe: { kind: 'woodpeckerBlock', size: 200 } },
      puzzleIds: [MATE_ONE_PUZZLE_ID],
      targetSize: 200,
      config: MASTERY_CONFIG,
    };
    const legacyCycles = LEGACY_AUTO_SET_IDS.map((id, index) =>
      completedCycle(`e2e:legacy-cycle-${index}`, id, [MATE_ONE_PUZZLE_ID], index * 10_000),
    );
    const legacyAttempts = LEGACY_AUTO_SET_IDS.map((id, index) =>
      cleanAttempt(MATE_ONE_PUZZLE_ID, id, `e2e:legacy-cycle-${index}`, index * 10_000),
    );
    const keepCycle = completedCycle('e2e:keep-cycle', OTHER_SET_ID, [EXCHANGE_PUZZLE_ID]);

    await seedIndexedDb(page, {
      puzzles: [MATE_ONE, EXCHANGE_WIN, MATERIAL_COMBINATION],
      sets: [...legacySets, keepSet, keepBlock],
      cycles: [...legacyCycles, keepCycle],
      attempts: [...legacyAttempts, cleanAttempt(EXCHANGE_PUZZLE_ID, OTHER_SET_ID, keepCycle.id)],
      removeLegacyAutoSetsMarker: true,
    });

    // Sanity: the legacy rows are present before the reload.
    const before = await readStore(page, 'trainingSets');
    for (const id of LEGACY_AUTO_SET_IDS) {
      expect(before.some((row) => row.id === id)).toBe(true);
    }

    await page.reload();

    // The cleanup ran before the home rendered: the real open block is visible.
    await expect(page.getByTestId('training-home')).toBeVisible();
    await expect(page.getByTestId('training-block-open-note')).toBeVisible();

    // The two legacy rows and their dependents are gone.
    const sets = await readStore(page, 'trainingSets');
    for (const id of LEGACY_AUTO_SET_IDS) {
      expect(sets.some((row) => row.id === id)).toBe(false);
    }
    const cycles = await readStore(page, 'trainingCycles');
    for (const id of LEGACY_AUTO_SET_IDS) {
      expect(cycles.some((row) => row.trainingSetId === id)).toBe(false);
    }
    const attempts = await readStore(page, 'puzzleAttempts');
    for (const id of LEGACY_AUTO_SET_IDS) {
      expect(attempts.some((row) => row.trainingSetId === id)).toBe(false);
    }

    // Unrelated sets, cycles, attempts and puzzles survive.
    expect(sets.some((row) => row.id === OTHER_SET_ID)).toBe(true);
    expect(sets.some((row) => row.id === KEEP_BLOCK_ID)).toBe(true);
    expect(cycles.some((row) => row.trainingSetId === OTHER_SET_ID)).toBe(true);
    expect(attempts.some((row) => row.trainingSetId === OTHER_SET_ID)).toBe(true);
    expect((await readStore(page, 'puzzles')).length).toBe(3);

    // The guard marker is written after the successful cleanup.
    const settings = await readStore(page, 'settings');
    expect(settings.find((row) => row.key === LEGACY_CLEANUP_MARKER_KEY)?.value).toBe(true);
  });
});
