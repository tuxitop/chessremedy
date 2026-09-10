import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react';
import type * as React from 'react';
import type { MoveTree, MovePly, Path } from './positionTree';
import { nagMeta } from './pgnAnnotations';
import styles from './MoveList.module.css';

/**
 * Lichess-style move list rendered as a table with three columns:
 * move number / White / Black. The mainline is a column table; variations
 * take their own indented lines directly under the move they replace:
 *
 *   1.   e4   e5
 *   2.   Nf3  Nc6
 *   3.   Bb5  a6
 *        (3. Bc4 a6 4. Ba4)
 *
 * NAG glyphs follow the SAN and colour the whole move. Comments render as
 * italic paragraphs under the row they belong to. The active ply carries
 * `aria-current="step"`.
 */

export type MovePart =
  | { readonly t: 'move'; readonly ply: MovePly; readonly path: Path }
  | { readonly t: 'text'; readonly text: string };

export interface MoveRowCell {
  parts: MovePart[];
  comments: string[];
}

export interface MoveListRow {
  readonly key: string;
  readonly num: string | null;
  readonly white: MoveRowCell | null;
  readonly black: MoveRowCell | null;
  /** Variation sub-lines rendered under the row (indented, own lines). */
  readonly variations: readonly MovePart[][];
}

export interface MoveToken {
  readonly ply: MovePly;
  readonly path: Path;
}

export interface MoveListModel {
  readonly rows: readonly MoveListRow[];
  /** Every ply (mainline + variations) in display order. */
  readonly tokens: readonly MoveToken[];
  /**
   * Variation sub-lines rendered under no numbered row (a pinned decision at
   * mainline depth 0 — e.g. wrong attempts played before any prefix/played
   * move exists). Present only when `pinnedDepth` clips an empty mainline.
   */
  readonly rootVariations?: readonly MovePart[][];
}

interface MainMove {
  readonly ply: MovePly;
  readonly path: Path;
  /** Alternatives to `ply` (siblings at the same position node). */
  readonly alts: readonly MovePly[];
}

function emptyCell(): MoveRowCell {
  return { parts: [], comments: [] };
}

function commentTexts(ply: MovePly): string[] {
  const out: string[] = [];
  for (const comment of ply.comments) {
    // Strip every structured PGN percent tag (%clk/%emt/%eval/%cal/%csl)
    // so annotations are never rendered as ordinary prose.
    const text = comment.replace(/\[%[a-z]+\s+[^\]]*\]/gi, '').trim();
    if (text) {
      out.push(text);
    }
  }
  return out;
}

/**
 * Numbered, bracketed parts for one variation sub-line:
 * `(3. Bc4 a6 4. Ba4)`. Numbers are included because variations have no
 * number column of their own.
 */
function variationParts(alt: MovePly, altPath: Path): MovePart[] {
  const parts: MovePart[] = [{ t: 'text', text: '(' }];
  let lastFullMove = -1;
  let lastWasWhite = false;
  let started = false;

  const pushSpaceAfterMove = (): void => {
    if (parts.length > 0 && parts[parts.length - 1]!.t === 'move') {
      parts.push({ t: 'text', text: ' ' });
    }
  };

  const write = (ply: MovePly, path: Path): void => {
    const needsNumber =
      !started || !(ply.color === 'black' && lastWasWhite && lastFullMove === ply.fullMove);
    if (needsNumber) {
      parts.push({
        t: 'text',
        text: ply.color === 'white' ? `${ply.fullMove}. ` : `${ply.fullMove}... `,
      });
    } else {
      pushSpaceAfterMove();
    }
    parts.push({ t: 'move', ply, path });
    lastFullMove = ply.fullMove;
    lastWasWhite = ply.color === 'white';
    started = true;
  };

  const walkPosition = (children: readonly MovePly[], prefix: Path): void => {
    if (children.length === 0) {
      return;
    }
    const main = children[0]!;
    const mainPath = [...prefix, main];
    write(main, mainPath);
    for (const childAlt of children.slice(1)) {
      const childAltPath = [...prefix, childAlt];
      pushSpaceAfterMove();
      for (const part of variationParts(childAlt, childAltPath)) {
        parts.push(part);
      }
    }
    walkPosition(main.children, mainPath);
  };

  write(alt, altPath);
  walkPosition(alt.children, altPath);
  parts.push({ t: 'text', text: ')' });
  return parts;
}

function collectMainline(rootChildren: readonly MovePly[], cap?: number): readonly MainMove[] {
  const out: MainMove[] = [];
  const prefix: MovePly[] = [];
  let children = rootChildren;
  while (children.length > 0 && (cap === undefined || prefix.length < cap)) {
    const main = children[0]!;
    const mainPath = [...prefix, main];
    out.push({ ply: main, path: mainPath, alts: children.slice(1) });
    prefix.push(main);
    children = main.children;
  }
  return out;
}

/**
 * Pure model builder — shared by the component and its tests.
 *
 * `pinnedDepth` (solve-screen opt-in) caps the collected mainline at that many
 * plies: the node reached after `pinnedDepth` plies is the "decision tail".
 * While a puzzle decision point is still unsolved, wrong attempts are stored
 * as its children, and without a pin the first one would read as the active
 * mainline continuation (`children[0]`). With the pin those children render as
 * parenthesized variation sub-lines under the row holding the decision move
 * instead — the wrong move never becomes the mainline. Review/Live Analysis
 * never pass `pinnedDepth`, so their model is unchanged.
 */
export function buildMoveListModel(tree: MoveTree, pinnedDepth?: number): MoveListModel {
  const rows: MoveListRow[] = [];
  const tokens: MoveToken[] = [];
  const mainline = collectMainline(tree.rootChildren, pinnedDepth);
  const rootVariations: MovePart[][] = [];
  let rowId = 0;

  let openRow: {
    num: string;
    white: MoveRowCell | null;
    black: MoveRowCell | null;
    variations: MovePart[][];
  } | null = null;

  const pushVariations = (path: Path, alts: readonly MovePly[]): void => {
    if (!openRow) {
      return;
    }
    for (const alt of alts) {
      const altPath = path.slice(0, -1).concat(alt);
      const parts = variationParts(alt, altPath);
      for (const part of parts) {
        if (part.t === 'move') {
          tokens.push({ ply: part.ply, path: part.path });
        }
      }
      openRow.variations.push(parts);
    }
  };

  const pushTokenParts = (parts: readonly MovePart[]): void => {
    for (const part of parts) {
      if (part.t === 'move') {
        tokens.push({ ply: part.ply, path: part.path });
      }
    }
  };

  const flushRow = (): void => {
    if (openRow) {
      rows.push({
        key: `row-${rowId++}`,
        num: openRow.num,
        white: openRow.white,
        black: openRow.black,
        variations: openRow.variations,
      });
      openRow = null;
    }
  };

  for (const { ply, path, alts } of mainline) {
    const cell = (): MoveRowCell => {
      const c = emptyCell();
      tokens.push({ ply, path });
      c.parts.push({ t: 'move', ply, path });
      c.comments.push(...commentTexts(ply));
      return c;
    };

    if (ply.color === 'white') {
      flushRow();
      openRow = { num: `${ply.fullMove}.`, white: cell(), black: null, variations: [] };
      pushVariations(path, alts);
    } else {
      if (openRow && openRow.black === null) {
        openRow.black = cell();
        pushVariations(path, alts);
        flushRow();
      } else {
        flushRow();
        openRow = { num: `${ply.fullMove}...`, white: null, black: cell(), variations: [] };
        pushVariations(path, alts);
        flushRow();
      }
    }
  }
  flushRow();

  // Decision-tail rendering (pinnedDepth set): the children of the decision
  // node (the node after `pinnedDepth` mainline plies) are wrong attempts with
  // no correct mainline continuation yet — show each as a variation sub-line
  // instead of letting them extend the mainline.
  if (pinnedDepth !== undefined) {
    if (pinnedDepth === 0) {
      // The decision node is the tree root: no numbered row exists to hang the
      // wrong attempts under, so they render as their own indented block.
      for (const child of tree.rootChildren) {
        const parts = variationParts(child, [child]);
        pushTokenParts(parts);
        rootVariations.push(parts);
      }
    } else if (mainline.length >= pinnedDepth) {
      const decision = mainline[pinnedDepth - 1]!;
      const lastRow = rows[rows.length - 1];
      if (lastRow !== undefined && decision.ply.children.length > 0) {
        const variations = [...lastRow.variations];
        for (const child of decision.ply.children) {
          const parts = variationParts(child, [...decision.path, child]);
          pushTokenParts(parts);
          variations.push(parts);
        }
        rows[rows.length - 1] = { ...lastRow, variations };
      }
    }
  }

  return {
    rows,
    tokens,
    ...(rootVariations.length > 0 ? { rootVariations } : {}),
  };
}

export interface MoveListProps {
  tree: MoveTree;
  /** Currently selected line (the position shown on the board). */
  path: Path;
  /** Fired when the user clicks/seeks a move. */
  onSeek?: (path: Path) => void;
  /**
   * Per-ply evaluation text (`ply.id → e.g. "+0.30"`), shown greyed on the
   * right of the move's column once that position has an engine evaluation.
   */
  plyEvals?: ReadonlyMap<number, string>;
  /**
   * Per-ply NAGs to display instead of the tree's own glyphs (e.g. Feature-008
   * move-classification glyphs on Game Review). Keyed by `ply.id`.
   */
  nagOverrides?: ReadonlyMap<number, readonly number[]>;
  /**
   * When `true`, the list scrolls the active move into view whenever the
   * active ply changes (puzzle solving with a long game prefix). Defaults to
   * `false` so Live Analysis / Game Review are untouched.
   */
  autoScroll?: boolean;
  /**
   * Solve-surface opt-in: pin the collected mainline to end at this many
   * plies (the unsolved puzzle decision node). The decision node's children
   * (wrong attempts played before any correct continuation) render as
   * variation sub-lines under the decision move's row instead of extending
   * the mainline. Absent (Review / Live Analysis) the tree's full
   * first-child chain is the mainline, as before.
   */
  pinnedDepth?: number;
}

export function MoveList({
  tree,
  path,
  onSeek,
  plyEvals,
  nagOverrides,
  autoScroll = false,
  pinnedDepth,
}: MoveListProps): React.JSX.Element {
  const model = useMemo(() => buildMoveListModel(tree, pinnedDepth), [tree, pinnedDepth]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeId = path.length > 0 ? path[path.length - 1]!.id : null;
  const { rows, tokens } = model;

  // Scroll the active move into view (puzzle prefix lines can be long). Runs
  // only when the active ply changes, so the user's own scrolling is never
  // fought while the selection stays put.
  useEffect(() => {
    if (!autoScroll || activeId === null) {
      return;
    }
    const list = listRef.current;
    if (!list) {
      return;
    }
    const active = list.querySelector<HTMLButtonElement>('[aria-current="step"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [autoScroll, activeId]);

  // Keep the keyboard focus ring on the active move: when the current ply
  // changes (e.g. left/right game navigation) while a move button is focused,
  // move the ring along with it instead of leaving a stray border behind.
  useEffect(() => {
    if (activeId === null) {
      return;
    }
    const list = listRef.current;
    const focused = document.activeElement;
    if (!list || !focused || !list.contains(focused)) {
      return;
    }
    const focusedPly = focused.getAttribute('data-ply-id');
    if (focusedPly === null || focusedPly === String(activeId)) {
      return;
    }
    const target = list.querySelector<HTMLButtonElement>(`[data-ply-id="${activeId}"]`);
    target?.focus();
  }, [activeId]);

  const moveToIndex = useCallback((buttons: HTMLButtonElement[], index: number): void => {
    if (buttons.length === 0) {
      return;
    }
    const target = buttons[((index % buttons.length) + buttons.length) % buttons.length];
    target?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const root = listRef.current;
      if (!root) {
        return;
      }
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-token-index]'));
      if (buttons.length === 0) {
        return;
      }
      const focused = document.activeElement as HTMLElement | null;
      const index = buttons.findIndex((b) => b === focused);

      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const idAttr = focused?.getAttribute('data-ply-id');
        const currentId = idAttr ? Number.parseInt(idAttr, 10) : Number.NaN;
        const current = tokens.find((t) => t.ply.id === currentId);
        if (!current) {
          return;
        }
        const parentKey = current.path
          .slice(0, -1)
          .map((p) => p.id)
          .join(',');
        const currentIdStr = String(currentId);
        const siblings = tokens
          .map((token, i) => ({ token, i }))
          .filter(
            ({ token }) =>
              token.path
                .slice(0, -1)
                .map((p) => p.id)
                .join(',') === parentKey && String(token.ply.id) !== currentIdStr,
          );
        if (siblings.length === 0) {
          return;
        }
        const currentPos = index;
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const targetIndex = Math.min(currentPos, buttons.length - 1);
        const targetButton = buttons[(targetIndex + delta + buttons.length) % buttons.length];
        const targetId = targetButton?.getAttribute('data-ply-id');
        const target = siblings.find((s) => String(s.token.ply.id) === targetId) ?? siblings[0];
        if (target) {
          onSeek?.(target.token.path);
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveToIndex(buttons, index + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveToIndex(buttons, index - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        moveToIndex(buttons, 0);
      } else if (event.key === 'End') {
        event.preventDefault();
        moveToIndex(buttons, buttons.length - 1);
      }
    },
    [tokens, onSeek, moveToIndex],
  );

  const renderParts = (
    rowKey: string,
    parts: readonly MovePart[],
    indexRef: { n: number },
  ): React.JSX.Element => (
    <>
      {parts.map((part, i) => {
        if (part.t === 'text') {
          return (
            <span className={styles.textToken} key={`${rowKey}-text-${i}`}>
              {part.text}
            </span>
          );
        }
        const isActive = part.ply.id === activeId;
        const effectiveNags = nagOverrides?.get(part.ply.id) ?? part.ply.nags;
        const color = effectiveNags.length > 0 ? nagMeta(effectiveNags[0]!)?.color : undefined;
        const plyEval = plyEvals?.get(part.ply.id);
        return (
          <Fragment key={`${rowKey}-m-${part.ply.id}`}>
            <button
              type="button"
              className={`${styles.move} ${isActive ? styles.moveActive : ''}`}
              style={color ? { color } : undefined}
              onClick={() => onSeek?.(part.path)}
              data-token-index={indexRef.n++}
              data-testid="move-list-move"
              data-san={part.ply.san}
              data-ply-id={part.ply.id}
              aria-current={isActive ? 'step' : undefined}
              aria-selected={isActive}
              role="treeitem"
            >
              {part.ply.san}
              {effectiveNags.map((nag) => {
                const meta = nagMeta(nag);
                return meta ? (
                  <span
                    className={styles.nag}
                    key={`${rowKey}-nag-${part.ply.id}-${nag}`}
                    data-testid="nag-glyph"
                    data-nag={meta.nag}
                  >
                    {meta.glyph}
                  </span>
                ) : null;
              })}
            </button>
            {plyEval !== undefined && (
              <span className={styles.plyEval} data-testid="ply-eval" data-ply-id={part.ply.id}>
                {plyEval}
              </span>
            )}
          </Fragment>
        );
      })}
    </>
  );

  const rootVariations = model.rootVariations;
  const isEmpty = rows.length === 0 && (rootVariations ?? []).length === 0;
  const indexRef = { n: 0 };

  return (
    <div
      className={styles.list}
      ref={listRef}
      role="tree"
      aria-label="Moves"
      tabIndex={0}
      data-testid="move-list"
      onKeyDown={handleKeyDown}
    >
      {isEmpty && (
        <div className={styles.empty} data-testid="move-list-empty">
          No moves yet — play on the board to build a line.
        </div>
      )}
      {rows.length === 0 &&
        (rootVariations ?? []).map((parts, v) => (
          <div className={styles.variation} role="group" key={`root-variation-${v}`}>
            <span className={styles.variationMarker} aria-hidden="true" />
            {renderParts(`root-v${v}`, parts, indexRef)}
          </div>
        ))}
      {rows.map((row) => (
        <Fragment key={row.key}>
          <div className={styles.row} role="group">
            <span className={styles.numCol} data-testid="move-num">
              {row.num}
            </span>
            <div className={styles.cell}>
              {row.white ? renderParts(row.key, row.white.parts, indexRef) : null}
            </div>
            <div className={styles.cell}>
              {row.black ? renderParts(row.key, row.black.parts, indexRef) : null}
            </div>
          </div>
          {row.variations.map((parts, v) => (
            <div className={styles.variation} role="group" key={`${row.key}-variation-${v}`}>
              <span className={styles.variationMarker} aria-hidden="true" />
              {renderParts(`${row.key}-v${v}`, parts, indexRef)}
            </div>
          ))}
          {(() => {
            const comments = [...(row.white?.comments ?? []), ...(row.black?.comments ?? [])];
            if (comments.length === 0) {
              return null;
            }
            return (
              <div className={styles.commentBlock} key={`${row.key}-comments`}>
                {comments.map((c, i) => (
                  <p className={styles.comment} key={`${row.key}-c-${i}`}>
                    {c}
                  </p>
                ))}
              </div>
            );
          })()}
        </Fragment>
      ))}
    </div>
  );
}
