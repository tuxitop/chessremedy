/**
 * Feature 018 — static "no domain math" guard.
 *
 * Home is a presentation/composition surface: every statistic is produced by
 * Feature 014 (and the canonical Feature 013 mastery derivation) and consumed
 * read-only. This guard reads the Home source and fails if it value-imports a
 * statistics computation module or calls a statistics computation function.
 * Type-only imports and the approved presentation helpers (including the
 * canonical `@/domain/training/mastery`) are allowed.
 *
 * It also proves the lazy code path: `src/hooks/useHome.ts` must reach the
 * browser data source through a dynamic import and never statically import the
 * statistics service, the engine or Recharts.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PRESENTATION_DIR = join(ROOT, 'src/presentation/home');
const COMPONENTS_DIR = join(ROOT, 'src/components/home');
const HOOK_FILE = join(ROOT, 'src/hooks/useHome.ts');
const PAGE_FILE = join(ROOT, 'src/pages/HomePage.tsx');

/** Value-import specifiers that would re-implement Feature-014/013 statistics. */
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
  '@/domain/analysis/classification',
  '@/domain/analysis/summary',
];

/** Computation calls that must never appear in the Home presentation. */
const FORBIDDEN_CALLS =
  /\b(computeCycleMetrics|computeStatistics|aggregateOf|setStatsFor|computeGameMetrics|compareCycleMetrics|weakestCategories|repeatedlyFailedPuzzles|computePhaseMetrics|resolvePuzzleCycle)\s*\(/;

function collectSources(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
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

const SOURCES = [
  ...collectSources(PRESENTATION_DIR),
  ...collectSources(COMPONENTS_DIR),
  ...[HOOK_FILE, PAGE_FILE].filter((file) => existsSync(file)),
];

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

describe('no domain statistics math in Home', () => {
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

  it('composes the Feature-015 presentation helpers instead of re-deriving math', () => {
    const selectors = collectSources(PRESENTATION_DIR);
    const consumers = selectors.filter((file) =>
      readFileSync(file, 'utf8').includes('@/presentation/dashboard'),
    );
    expect(consumers.length).toBeGreaterThan(0);
  });

  it('reaches the browser data source through a dynamic import', () => {
    expect(existsSync(HOOK_FILE)).toBe(true);
    const hook = readFileSync(HOOK_FILE, 'utf8');
    expect(hook).toContain("import('@/infrastructure/home/");

    const staticSpecifiers = valueImportSpecifiers(hook);
    for (const forbidden of [
      '@/infrastructure/statistics',
      '@/infrastructure/engine',
      'recharts',
    ]) {
      expect(staticSpecifiers.some((specifier) => specifier.startsWith(forbidden))).toBe(false);
    }
  });
});
