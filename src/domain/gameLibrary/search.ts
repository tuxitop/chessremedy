/**
 * Game Library search (Feature 007).
 *
 * Matches **any** searchable field, case-insensitively, after trimming and
 * collapsing interior whitespace. ANDs with the other filters.
 */

import type { LibraryGameRow } from './index';

/** Normalize search input: trim and collapse interior whitespace runs. */
export function normalizeSearch(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True when the row matches any searchable field for the given query. */
export function matchesSearch(row: LibraryGameRow, query: string): boolean {
  const needle = normalizeSearch(query);
  if (needle === '') {
    return true;
  }
  const haystacks = [row.whiteName, row.blackName, row.externalId ?? ''].map((s) =>
    normalizeSearch(s),
  );
  return haystacks.some((haystack) => haystack.includes(needle));
}
