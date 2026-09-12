/**
 * Feature 013 — application bootstrap (composition root seam).
 *
 * Awaited once in `main.tsx` before the first render so infrastructure data
 * remediation completes before any route — including the training surfaces —
 * reads `trainingSets`. Today it runs the one-time legacy auto-set cleanup.
 *
 * It is deliberately best-effort: `runLegacyAutoSetCleanup` never throws, and
 * `bootstrap` additionally swallows any rejection so a storage failure still
 * renders the app.
 */

import {
  runLegacyAutoSetCleanup,
  type LegacyAutoSetCleanupDeps,
} from '@/infrastructure/training/legacy-auto-set-cleanup';

/**
 * Run startup remediation. Resolves once it has been attempted; it never
 * rejects, even when a dependency throws.
 */
export async function bootstrap(deps?: LegacyAutoSetCleanupDeps): Promise<void> {
  try {
    await runLegacyAutoSetCleanup(deps);
  } catch {
    // Best-effort: never block startup.
  }
}
