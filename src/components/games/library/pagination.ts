/**
 * Pure pagination math for the Game Library results window (Feature 017 §6).
 *
 * The label is derived from the rendered page window and the matched total
 * only; the stored table size (`totalStored`) is never a denominator.
 */

/** Number of pages for `total` matched rows at `pageSize` rows per page. */
export function totalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Number of rows rendered on the 1-based `page` of a `total`-row result. */
export function pageWindow(total: number, page: number, pageSize: number): number {
  return Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
}

/** `"Showing {shown} of {total} games"`, singular at a total of one. */
export function showingLabel(shown: number, total: number): string {
  return `Showing ${shown} of ${total} ${total === 1 ? 'game' : 'games'}`;
}
