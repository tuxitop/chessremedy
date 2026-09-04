/**
 * Game Library selection (Feature 007).
 *
 * Selection is a set of game ids independent of rendered DOM rows so it
 * scales with the result set and survives future pagination/virtualization.
 * Selection is cleared whenever filters or search change, or after deletion
 * (specs/domain/game-library.md).
 */

export interface GameSelection {
  /** Selected game ids. */
  readonly ids: ReadonlySet<string>;
  toggle(id: string): GameSelection;
  /** Replace the selection with the given ids (e.g. the filtered result set). */
  selectAll(ids: Iterable<string>): GameSelection;
  clear(): GameSelection;
  isSelected(id: string): boolean;
  readonly count: number;
}

export function createSelection(initial: Iterable<string> = []): GameSelection {
  return new GameSelectionImpl(new Set(initial));
}

class GameSelectionImpl implements GameSelection {
  readonly ids: ReadonlySet<string>;

  constructor(ids: ReadonlySet<string>) {
    this.ids = ids;
  }

  get count(): number {
    return this.ids.size;
  }

  isSelected(id: string): boolean {
    return this.ids.has(id);
  }

  toggle(id: string): GameSelection {
    const next = new Set(this.ids);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return new GameSelectionImpl(next);
  }

  selectAll(ids: Iterable<string>): GameSelection {
    return new GameSelectionImpl(new Set(ids));
  }

  clear(): GameSelection {
    return createSelection();
  }
}
