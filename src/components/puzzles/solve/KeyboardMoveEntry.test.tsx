import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { parsePositionFen } from '@/domain/chess';
import { trainingRowFixture } from '@/domain/training/test-support';
import { KeyboardMoveEntry, textMoveToUci } from './KeyboardMoveEntry';
import type { Position } from '@/domain/chess';

const CASTLING = trainingRowFixture('castling');
const PROMOTION = trainingRowFixture('promotion');

function positionOf(row: { readonly startingFen: string }): Position {
  const parsed = parsePositionFen(row.startingFen);
  if (!parsed.ok) {
    throw new Error('Fixture FEN should parse.');
  }
  return parsed.position;
}

describe('textMoveToUci (Feature 012, pointer-free entry)', () => {
  it('parses SAN including castling to canonical UCI', () => {
    const position = positionOf(CASTLING);
    expect(textMoveToUci(position, 'O-O')).toEqual({ ok: true, uci: 'e1h1' });
  });

  it('parses canonical UCI promotion with its piece', () => {
    const position = positionOf(PROMOTION);
    expect(textMoveToUci(position, 'c7c8q')).toEqual({ ok: true, uci: 'c7c8q' });
  });

  it('rejects illegal and non-move text', () => {
    const position = positionOf(CASTLING);
    expect(textMoveToUci(position, 'e2e4').ok).toBe(false);
    expect(textMoveToUci(position, 'not a move').ok).toBe(false);
    expect(textMoveToUci(position, '   ').ok).toBe(false);
  });
});

describe('KeyboardMoveEntry (Feature 012, Stage D)', () => {
  it('submits a legal SAN entry and clears the field', () => {
    const onSubmit = vi.fn();
    render(<KeyboardMoveEntry position={positionOf(CASTLING)} onSubmitLegalMove={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Enter a move'), { target: { value: 'O-O' } });
    fireEvent.click(screen.getByTestId('puzzle-move-submit'));

    expect(onSubmit).toHaveBeenCalledWith('e1h1');
    expect(screen.getByLabelText('Enter a move')).toHaveValue('');
    expect(screen.queryByTestId('puzzle-move-entry-error')).not.toBeInTheDocument();
  });

  it('rejects an illegal entry with feedback and never submits it', () => {
    const onSubmit = vi.fn();
    render(<KeyboardMoveEntry position={positionOf(CASTLING)} onSubmitLegalMove={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Enter a move'), { target: { value: 'e2e4' } });
    fireEvent.click(screen.getByTestId('puzzle-move-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('puzzle-move-entry-error')).toHaveTextContent('not a legal move');
  });

  it('is disabled while no move may be entered (viewing an earlier ply)', () => {
    const onSubmit = vi.fn();
    render(<KeyboardMoveEntry position={null} onSubmitLegalMove={onSubmit} />);

    expect(screen.getByLabelText('Enter a move')).toBeDisabled();
    expect(screen.getByTestId('puzzle-move-submit')).toBeDisabled();
  });
});
