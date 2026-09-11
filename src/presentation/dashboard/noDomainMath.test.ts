/**
 * Feature 015 — static "no domain math" guard.
 *
 * Feature 015 is presentation only: every value is computed by Feature 014 and
 * consumed through the `useDashboard` hook and the Stage-1 presentation layer.
 * This guard reads the dashboard source and fails if a component/page
 * value-imports a statistics computation module or calls a statistics
 * computation function. Type-only imports and the approved presentation
 * helpers (including `cycleTimeGoal`) are allowed.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const COMPONENTS_DIR = join(ROOT, 'src/components/dashboard');
const PRESENTATION_DIR = join(ROOT, 'src/presentation/dashboard');
const PAGE_FILE = join(ROOT, 'src/pages/DashboardPage.tsx');

/** Value-import specifiers that would re-implement Feature-014 statistics. */
const FORBIDDEN_IMPORTS: readonly string[] = [
  '@/domain/statistics',
  '@/domain/statistics/compute',
  '@/domain/statistics/aggregate',
  '@/domain/statistics/training',
  '@/domain/statistics/gameMetrics',
  '@/domain/statistics/phase',
  '@/domain/statistics/trends',
  '@/domain/statistics/rating',
  '@/domain/statistics/history',
  '@/domain/statistics/eligibility',
  '@/domain/statistics/query',
  '@/domain/statistics/version',
  '@/domain/statistics/periods',
  '@/domain/training/cycleMetrics',
  '@/domain/training/mastery',
  '@/domain/analysis/classification',
  '@/domain/analysis/summary',
];

/** Computation calls that must never appear in the dashboard presentation. */
const FORBIDDEN_CALLS =
  /\b(computeCycleMetrics|computeStatistics|aggregateOf|notDetectedAggregate|emptyAggregate|compareCycleMetrics|setStatsFor|weakestCategories|repeatedlyFailedPuzzles|resolvePuzzleCycle|computePhaseMetrics)\s*\(/;

function collectSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSources(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) {
      continue;
    }
    files.push(full);
  }
  return files;
}

const SOURCES = [...collectSources(COMPONENTS_DIR), ...collectSources(PRESENTATION_DIR), PAGE_FILE];

/** Every `from '…'` specifier of a value import (type-only imports removed). */
function valueImportSpecifiers(source: string): readonly string[] {
  const withoutTypeImports = source.replace(/import\s+type\s[^;]*?from\s*'[^']+';/gs, '');
  const specifiers: string[] = [];
  const pattern = /from\s*'([^']+)'/g;
  let match = pattern.exec(withoutTypeImports);
  while (match !== null) {
    specifiers.push(match[1] ?? '');
    match = pattern.exec(withoutTypeImports);
  }
  return specifiers;
}

describe('no domain statistics math in the dashboard', () => {
  it('never value-imports a statistics computation module', () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      for (const specifier of valueImportSpecifiers(readFileSync(file, 'utf8'))) {
        if (FORBIDDEN_IMPORTS.includes(specifier)) {
          offenders.push(`${relative(ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never calls a statistics computation function', () => {
    const offenders = SOURCES.filter((file) => FORBIDDEN_CALLS.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it('consumes the Feature-014 result through the presentation layer and hook', () => {
    const presentationConsumers = SOURCES.filter((file) =>
      readFileSync(file, 'utf8').includes('@/presentation/dashboard'),
    );
    expect(presentationConsumers.length).toBeGreaterThan(0);

    const page = readFileSync(PAGE_FILE, 'utf8');
    expect(page).toContain('@/hooks/useDashboard');
    expect(page).toContain('@/components/dashboard');
  });
});
