import { useRef, useState } from 'react';
import type * as React from 'react';
import { parseSan } from 'chessops/san';
import { isNormal } from 'chessops/types';
import { makeUci, parseUci } from 'chessops/util';
import type { Position } from '@/domain/chess';
import { Button } from '@/components/ui/Button';
import styles from './KeyboardMoveEntry.module.css';

/** Result of parsing one text entry against the live position. */
export type TextMoveParseResult =
  { readonly ok: true; readonly uci: string } | { readonly ok: false; readonly message: string };

/**
 * Pointer-free move entry (plan R-4 / AC #10): a labelled "Enter a move" field
 * accepting SAN or canonical UCI, validated against the live position with
 * `chessops/san`. An illegal entry is rejected here with feedback and is never
 * counted as a wrong move; a legal entry is submitted as its canonical UCI and
 * goes through the same domain evaluation as a board move.
 */
export function textMoveToUci(position: Position, text: string): TextMoveParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'Enter a move first.' };
  }
  const san = parseSan(position, trimmed);
  if (san !== undefined && isNormal(san) && position.isLegal(san)) {
    return { ok: true, uci: makeUci(san) };
  }
  const uci = parseUci(trimmed);
  if (uci !== undefined && isNormal(uci) && position.isLegal(uci)) {
    return { ok: true, uci: makeUci(uci) };
  }
  return { ok: false, message: `"${trimmed}" is not a legal move here.` };
}

export interface KeyboardMoveEntryProps {
  /** Live decision-point position; move entry is enabled only when given. */
  readonly position: Position | null;
  /** Fired with the canonical UCI of a legal entry (parent applies the move). */
  readonly onSubmitLegalMove: (uci: string) => void;
}

/**
 * The labelled text move-entry field (plan R-4). Disabled while no move may be
 * entered (viewing an earlier ply — transport is view-only, R-10). Rejections
 * are announced inline and never counted as wrong moves.
 */
export function KeyboardMoveEntry({
  position,
  onSubmitLegalMove,
}: KeyboardMoveEntryProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const disabled = position === null;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (position === null) {
      return;
    }
    const parsed = textMoveToUci(position, text);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    setText('');
    onSubmitLegalMove(parsed.uci);
  };

  return (
    <form className={styles.entry} onSubmit={submit} data-testid="keyboard-move-entry">
      <label className={styles.label} htmlFor="puzzle-move-entry">
        Enter a move
      </label>
      <div className={styles.row}>
        <input
          id="puzzle-move-entry"
          ref={inputRef}
          className={styles.input}
          type="text"
          value={text}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder="SAN or UCI (e.g. Nf3 or g1f3)"
          aria-describedby={error !== null ? 'puzzle-move-entry-error' : undefined}
          onChange={(event) => {
            setText(event.target.value);
            if (error !== null) {
              setError(null);
            }
          }}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={disabled || text.trim().length === 0}
          data-testid="puzzle-move-submit"
        >
          Play move
        </Button>
      </div>
      {error !== null ? (
        <p
          id="puzzle-move-entry-error"
          className={styles.error}
          role="alert"
          data-testid="puzzle-move-entry-error"
        >
          {error}
        </p>
      ) : (
        <p className={styles.hint} id="puzzle-move-entry-error">
          SAN or UCI — for example Nf3 or g1f3.
        </p>
      )}
    </form>
  );
}
