import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MoveList } from './MoveList';
import { buildTreeFromPgn, pathToLanding } from './positionTree';
import { buildSolveLine, mainlinePathOf } from './puzzleMoveLine';
import { nagMeta } from './pgnAnnotations';
import type { MoveTree, Path } from './positionTree';

function treeOf(pgn: string): MoveTree {
  const built = buildTreeFromPgn(pgn);
  if (built.error) {
    throw new Error(built.error);
  }
  return built.tree;
}

function sansOf(pgn: string): string[] {
  const tree = treeOf(pgn);
  const moves = screen.getAllByTestId('move-list-move');
  void tree;
  return moves.map((m) => m.getAttribute('data-san') ?? '');
}

describe('MoveList', () => {
  it('renders move numbers once per pair (not per ply)', () => {
    render(<MoveList tree={treeOf('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#')} path={[]} />);
    const nums = screen.getAllByTestId('move-num').map((n) => n.textContent);
    expect(nums).toEqual(['1.', '2.', '3.', '4.']);
    const sans = screen.getAllByTestId('move-list-move').map((m) => m.getAttribute('data-san'));
    expect(sans).toEqual(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
  });

  it('renders variations inline as (3. Bc4) and keeps them clickable', () => {
    const onSeek = vi.fn();
    const tree = treeOf('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4');
    render(<MoveList tree={tree} path={[]} onSeek={onSeek} />);
    const sans = sansOf('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4');
    expect(sans).toContain('Bb5');
    expect(sans).toContain('Bc4');
    expect(sans).toContain('a6');
    const bc4 = screen
      .getAllByTestId('move-list-move')
      .find((m) => m.getAttribute('data-san') === 'Bc4');
    expect(bc4).toBeTruthy();
    if (bc4) {
      fireEvent.click(bc4);
      expect(onSeek).toHaveBeenCalledTimes(1);
      const path = onSeek.mock.calls[0]![0] as Path;
      expect(path[path.length - 1]?.san).toBe('Bc4');
    }
  });

  it('renders the number column text 3. Bb5 (3. Bc4) like Lichess text', () => {
    render(<MoveList tree={treeOf('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4')} path={[]} />);
    const list = screen.getByTestId('move-list');
    expect(list.textContent).toContain('Bb5');
    expect(list.textContent).toContain('(3. Bc4)');
  });

  it('marks exactly one ply as aria-current when a path is given', () => {
    const tree = treeOf('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#');
    const landing = pathToLanding(tree);
    render(<MoveList tree={tree} path={landing} />);
    const active = screen
      .getAllByTestId('move-list-move')
      .filter((m) => m.getAttribute('aria-current') === 'step');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute('data-san', 'Qxf7#');
  });

  it('renders NAG glyphs with the move and colors the move text', () => {
    render(<MoveList tree={treeOf('1. e4 $1 e5 $2 2. Nf3 $3 Nc6 $4')} path={[]} />);
    const glyphs = screen.getAllByTestId('nag-glyph');
    expect(glyphs.map((g) => g.textContent)).toEqual(['!', '?', '!!', '??']);
    const move = screen
      .getAllByTestId('move-list-move')
      .find((m) => m.getAttribute('data-san') === 'e4');
    expect(move).toBeTruthy();
    if (move) {
      expect(move.getAttribute('style')).toContain(nagMeta(1)?.color);
    }
  });

  it('renders readable comments under their move', () => {
    render(
      <MoveList
        tree={treeOf("1. e4 {The King's Pawn opening} e5 {A solid response} 2. Nf3")}
        path={[]}
      />,
    );
    expect(screen.getByText("The King's Pawn opening")).toBeInTheDocument();
    expect(screen.getByText('A solid response')).toBeInTheDocument();
  });

  it('never renders %clk/%emt/%eval clock or evaluation tags as comments', () => {
    render(
      <MoveList
        tree={treeOf('1. e4 { [%clk 0:04:37] [%eval 0.18] } e5 { [%clk 0:03:59] } 2. Nf3')}
        path={[]}
      />,
    );
    const list = screen.getByTestId('move-list');
    expect(list.textContent).not.toContain('%clk');
    expect(list.textContent).not.toContain('%eval');
    expect(list.textContent).not.toContain('0:04:37');
  });

  it('renders an empty state when the tree has no moves', () => {
    const built = buildTreeFromPgn('[FEN "4k3/8/8/8/8/8/8/4K3 w - - 0 1"]');
    expect(built.error).toBeUndefined();
    render(<MoveList tree={built.tree} path={[]} />);
    expect(screen.getByTestId('move-list-empty')).toBeInTheDocument();
  });

  it('renders greyed per-ply evaluations at the right of their column', () => {
    const tree = treeOf('1. e4 e5');
    const white = tree.rootChildren[0]!;
    const black = white.children[0]!;
    render(
      <MoveList
        tree={tree}
        path={[]}
        plyEvals={
          new Map([
            [white.id, '+0.30'],
            [black.id, '+0.40'],
          ])
        }
      />,
    );
    const evals = screen.getAllByTestId('ply-eval').map((n) => n.textContent);
    expect(evals).toEqual(['+0.30', '+0.40']);
  });

  it('renders classification glyphs from nagOverrides instead of the tree NAGs', () => {
    const tree = treeOf('1. e4 e5 2. g4 Qh4#');
    const e4 = tree.rootChildren[0]!;
    const e5 = e4.children[0]!;
    const g4 = e5.children[0]!;
    const overrides = new Map<number, readonly number[]>([
      [e4.id, [1]], // good → !
      [g4.id, [4]], // blunder → ??
    ]);
    render(<MoveList tree={tree} path={[]} nagOverrides={overrides} />);
    const glyphs = screen
      .getAllByTestId('nag-glyph')
      .map((g) => ({ nag: g.getAttribute('data-nag'), text: g.textContent }));
    expect(glyphs).toEqual([
      { nag: '1', text: '!' },
      { nag: '4', text: '??' },
    ]);
  });

  it('renders no glyph for an empty-array override and hides the tree NAGs', () => {
    const tree = treeOf('1. e4 $1 e5 $4 2. g4 Qh4#');
    const e4 = tree.rootChildren[0]!;
    const e5 = e4.children[0]!;
    const overrides = new Map<number, readonly number[]>([
      [e4.id, []], // ordinary (good) move: no classification glyph
      [e5.id, []], // suppress the imported tree ?? as well
    ]);
    render(<MoveList tree={tree} path={[]} nagOverrides={overrides} />);
    expect(screen.queryAllByTestId('nag-glyph')).toHaveLength(0);
  });

  it('scrolls the active move into view when autoScroll is on and the active ply changes', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const tree = treeOf('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#');
      const { rerender } = render(<MoveList tree={tree} path={[]} autoScroll />);
      expect(scrollIntoView).not.toHaveBeenCalled();
      const landing = pathToLanding(tree);
      rerender(<MoveList tree={tree} path={landing} autoScroll />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not auto-scroll when the opt-in prop is off (Review/Live untouched)', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const tree = treeOf('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#');
      const { rerender } = render(<MoveList tree={tree} path={[]} />);
      const landing = pathToLanding(tree);
      rerender(<MoveList tree={tree} path={landing} />);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  // --- Pinned solve decision tail (wrong moves at an unsolved decision) -----

  const STANDARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('renders a wrong attempt at an unsolved decision node as a parenthesized variation, not as the active mainline', () => {
    const built = buildSolveLine({
      startFen: STANDARD,
      mainline: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
      variations: [{ depth: 4, uci: 'd2d4' }],
    });
    expect(built.error).toBeUndefined();
    const onSeek = vi.fn();
    const decisionPath = mainlinePathOf(built.tree, 4);
    render(<MoveList tree={built.tree} path={decisionPath} onSeek={onSeek} pinnedDepth={4} />);

    // The mainline ends at the decision move (Nc6); the wrong d4 is a
    // variation token rendered as `(3. d4)` — never a mainline row.
    const list = screen.getByTestId('move-list');
    expect(list.textContent).toContain('(3. d4)');
    const active = screen
      .getAllByTestId('move-list-move')
      .filter((m) => m.getAttribute('aria-current') === 'step');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute('data-san', 'Nc6');
    const d4 = screen
      .getAllByTestId('move-list-move')
      .find((m) => m.getAttribute('data-san') === 'd4');
    expect(d4).toBeTruthy();
    expect(d4?.getAttribute('aria-current')).toBeNull();

    // Clicking the wrong variation seeks into it (the user may inspect and
    // navigate back).
    if (d4) {
      fireEvent.click(d4);
      expect(onSeek).toHaveBeenCalledTimes(1);
      const path = onSeek.mock.calls[0]![0] as Path;
      expect(path).toHaveLength(5);
      expect(path[path.length - 1]?.san).toBe('d4');
    }
  });

  it('without a pin the same leaf wrong attempt is the (old) mainline continuation', () => {
    const built = buildSolveLine({
      startFen: STANDARD,
      mainline: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
      variations: [{ depth: 4, uci: 'd2d4' }],
    });
    expect(built.error).toBeUndefined();
    render(<MoveList tree={built.tree} path={[]} />);
    // d4 becomes a numbered mainline row (3. d4), not a parenthesized variant.
    const sans = screen.getAllByTestId('move-list-move').map((m) => m.getAttribute('data-san'));
    expect(sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'd4']);
    expect(screen.getByTestId('move-list').textContent).not.toContain('(');
  });

  it('renders root-level wrong attempts as variations when the pinned mainline is empty (no prefix)', () => {
    const built = buildSolveLine({
      startFen: STANDARD,
      mainline: [],
      variations: [{ depth: 0, uci: 'e2e4' }],
    });
    expect(built.error).toBeUndefined();
    render(<MoveList tree={built.tree} path={[]} pinnedDepth={0} />);
    const list = screen.getByTestId('move-list');
    expect(screen.queryByTestId('move-list-empty')).not.toBeInTheDocument();
    expect(list.textContent).toContain('(1. e4)');
    const active = screen
      .getAllByTestId('move-list-move')
      .filter((m) => m.getAttribute('aria-current') === 'step');
    expect(active).toHaveLength(0);
  });
});
