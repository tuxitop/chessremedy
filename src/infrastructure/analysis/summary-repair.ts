/**
 * Feature 009/010 — one-time missed-tactic summary repair (infrastructure).
 *
 * The tactical-detection pass used to build the per-analysis summary from the
 * **un-annotated** `MoveAnalysis` records, so a verified missed tactic stayed
 * counted in its raw classification bucket (typically `blunder`) while also
 * being counted as a missed tactic. The pass now threads the annotated records
 * into the summary (ADR-023 exclusivity, W3), but summaries already persisted
 * by the affected build keep the double count.
 *
 * The verdicts and the per-ply annotations on `MoveAnalysis` are correct; only
 * the derived summary counts are wrong. This one-time, **engine-free**,
 * idempotent step rebuilds every `completed` summary's classification counts
 * from its stored records, so existing libraries are corrected without a
 * re-scan.
 *
 * It is **not** a Dexie schema migration (`PERSISTENCE_SCHEMA_VERSION` is
 * unchanged), never creates a row, and is best-effort: a failure leaves the
 * marker unwritten so the next startup retries, and it never throws. The guard
 * marker `analysis.missedTacticSummaryRepair` is written only after a
 * successful run. Only the derived counts are patched — the summary's detection
 * state/version/provenance and puzzle-generation fields are preserved.
 */

import { buildAnalysisSummary } from '@/domain/analysis/summaryDerivation';
import { SETTINGS_KEYS } from '@/config/app-config';
import type { AnalysisRepository } from '@/infrastructure/db/analysis-repository';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import type { AnalysisSummariesRepository } from '@/infrastructure/db/summaries-repository';
import { summariesRepository } from '@/infrastructure/db/summaries-repository';
import type { SettingsRepository } from '@/infrastructure/db/settings-repository';
import { settingsRepository } from '@/infrastructure/db/settings-repository';

/** The repair's own version; bumping it re-runs the pass once more. */
export const MISSED_TACTIC_SUMMARY_REPAIR_VERSION = 1;

/** The minimal repositories the repair needs (injectable for tests). */
export interface SummaryRepairDeps {
  readonly analyses: Pick<AnalysisRepository, 'listForGameAndAnalysis'>;
  readonly summaries: Pick<AnalysisSummariesRepository, 'listAll' | 'putForAnalysis'>;
  readonly settings: Pick<SettingsRepository, 'get' | 'set'>;
  readonly now?: () => number;
}

/** Outcome of a repair run. */
export interface SummaryRepairResult {
  /** `repaired` when the run happened, `already-repaired` when guarded, `failed` on error. */
  readonly status: 'repaired' | 'already-repaired' | 'failed';
  /** Number of completed summaries inspected. */
  readonly scanned: number;
  /** Number of summaries whose counts actually changed and were rewritten. */
  readonly rewritten: number;
}

/**
 * Rebuild the classification counts of every completed per-analysis summary
 * from its persisted `MoveAnalysis` records. Idempotent and best-effort: when
 * the settings marker already matches the version it is a no-op; otherwise it
 * rewrites the affected rows and then writes the marker. Any error yields
 * `{ status: 'failed' }` without writing the marker. Never throws.
 */
export async function repairMissedTacticSummaries(
  deps: SummaryRepairDeps = {
    analyses: analysesRepository,
    summaries: summariesRepository,
    settings: settingsRepository,
  },
): Promise<SummaryRepairResult> {
  try {
    const done = await deps.settings.get<number>(SETTINGS_KEYS.missedTacticSummaryRepair);
    if (done === MISSED_TACTIC_SUMMARY_REPAIR_VERSION) {
      return { status: 'already-repaired', scanned: 0, rewritten: 0 };
    }
    const now = deps.now ?? ((): number => Date.now());
    const summaries = await deps.summaries.listAll();
    let scanned = 0;
    let rewritten = 0;
    for (const summary of summaries) {
      if (summary.detectionState !== 'completed') {
        continue;
      }
      scanned += 1;
      const records = await deps.analyses.listForGameAndAnalysis(
        summary.gameId,
        summary.analysisId,
      );
      if (records.length === 0) {
        continue;
      }
      const built = buildAnalysisSummary(records, summary.userColor, {
        detectionState: 'completed',
        detectionVersion: summary.detectionVersion,
      });
      const changed =
        built.classificationCounts.blunder !== summary.classificationCounts.blunder ||
        built.missedTacticCount !== summary.missedTacticCount;
      if (changed) {
        // Patch only the derived counts; keep the stored detection state,
        // version, provenance and puzzle-generation fields intact.
        await deps.summaries.putForAnalysis({
          ...summary,
          classificationCounts: built.classificationCounts,
          missedTacticCount: built.missedTacticCount,
          updatedAt: now(),
        });
        rewritten += 1;
      }
    }
    await deps.settings.set(
      SETTINGS_KEYS.missedTacticSummaryRepair,
      MISSED_TACTIC_SUMMARY_REPAIR_VERSION,
    );
    return { status: 'repaired', scanned, rewritten };
  } catch {
    return { status: 'failed', scanned: 0, rewritten: 0 };
  }
}
