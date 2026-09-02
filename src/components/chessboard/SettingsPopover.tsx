import { useEffect, useId, useRef, useState } from 'react';
import type * as React from 'react';
import { BOARD_THEMES, PIECE_SETS, type BoardTheme, type PieceSet } from './themes';
import styles from './SettingsPopover.module.css';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SettingsState {
  orientation: 'white' | 'black';
  coordinates: boolean;
  showLegalMoves: boolean;
  animation: boolean;
  drawable: boolean;
  interactive: boolean;
  boardTheme: BoardTheme;
  pieceSet: PieceSet;
}

export interface SettingsPopoverProps {
  state: SettingsState;
  onChange: (next: SettingsState) => void;
  onResetBoardSize: () => void;
  onClearArrows: () => void;
  /** Current board size in px (display-only). */
  boardSize: number;
}

/**
 * Settings cog + popover that lives at the top-right of the move-list
 * pane. Mirrors the Lichess analysis page UX.
 *
 * The popover is anchored to the cog button, traps focus inside while
 * open, and closes on outside click, `Escape`, or clicking the cog again.
 */
export function SettingsPopover({
  state,
  onChange,
  onResetBoardSize,
  onClearArrows,
  boardSize,
}: SettingsPopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const cogRef = useRef<HTMLButtonElement | null>(null);
  const triggerId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const popover = popoverRef.current;
    const focusables = (): HTMLElement[] =>
      popover ? Array.from(popover.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    const first = (): HTMLElement | undefined => focusables()[0];
    const last = (): HTMLElement | undefined => focusables()[focusables().length - 1];

    const handlePointer = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      if (!root.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        cogRef.current?.focus();
        return;
      }
      if (event.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) {
          return;
        }
        const current = document.activeElement as HTMLElement | null;
        const index = list.indexOf(current!);
        if (event.shiftKey) {
          if (index <= 0) {
            event.preventDefault();
            last()?.focus();
          }
        } else if (index === list.length - 1 || index === -1) {
          event.preventDefault();
          first()?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    // Move focus into the dialog once it is mounted.
    const raf = requestAnimationFrame(() => {
      first()?.focus();
    });
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]): void => {
    onChange({ ...state, [key]: value });
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        ref={cogRef}
        className={styles.cog}
        onClick={() => setOpen((cur) => !cur)}
        aria-label="Board settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={triggerId}
        data-testid="settings-cog"
      >
        ⚙
      </button>
      {open && (
        <div
          id={triggerId}
          ref={popoverRef}
          className={styles.popover}
          role="dialog"
          aria-label="Board settings"
          aria-modal="true"
          data-testid="settings-popover"
        >
          <div className={styles.section}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={state.orientation === 'black'}
                onChange={(e) => update('orientation', e.target.checked ? 'black' : 'white')}
                data-testid="setting-orientation"
              />
              <span>Black at bottom</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={state.showLegalMoves}
                onChange={(e) => update('showLegalMoves', e.target.checked)}
                data-testid="setting-show-legal-moves"
              />
              <span>Show legal moves</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={state.coordinates}
                onChange={(e) => update('coordinates', e.target.checked)}
                data-testid="setting-coordinates"
              />
              <span>Coordinates</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={state.animation}
                onChange={(e) => update('animation', e.target.checked)}
                data-testid="setting-animation"
              />
              <span>Animation</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={state.drawable}
                onChange={(e) => update('drawable', e.target.checked)}
                data-testid="setting-drawable"
              />
              <span>Drawable</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={state.interactive}
                onChange={(e) => update('interactive', e.target.checked)}
                data-testid="setting-interactive"
              />
              <span>Interactive</span>
            </label>
          </div>

          <div className={styles.section}>
            <fieldset className={styles.fieldset}>
              <legend>Board theme</legend>
              {BOARD_THEMES.map((t) => (
                <label key={t} className={styles.radio}>
                  <input
                    type="radio"
                    name="board-theme"
                    value={t}
                    checked={state.boardTheme === t}
                    onChange={() => update('boardTheme', t)}
                    data-testid={`setting-board-theme-${t}`}
                  />
                  <span>{t}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend>Piece set</legend>
              {PIECE_SETS.map((p) => (
                <label key={p} className={styles.radio}>
                  <input
                    type="radio"
                    name="piece-set"
                    value={p}
                    checked={state.pieceSet === p}
                    onChange={() => update('pieceSet', p)}
                    data-testid={`setting-piece-set-${p}`}
                  />
                  <span>{p}</span>
                </label>
              ))}
            </fieldset>
          </div>

          <div className={styles.section}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={onResetBoardSize}
              data-testid="setting-reset-board-size"
            >
              Reset board size ({boardSize}px → 480px)
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={onClearArrows}
              data-testid="setting-clear-arrows"
            >
              Clear arrows
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
