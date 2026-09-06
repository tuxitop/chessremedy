import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvaluationBar } from './EvaluationBar';

describe('EvaluationBar', () => {
  it('shows no fill without an evaluation', () => {
    render(<EvaluationBar evaluation={null} sideToMove="white" />);
    expect(screen.getByTestId('evaluation-bar-fill')).not.toHaveAttribute('style');
    expect(screen.getByTestId('evaluation-bar-center')).toBeInTheDocument();
  });

  it('fills by the White advantage (white-positive, not orientation)', () => {
    render(<EvaluationBar evaluation={{ cp: 3000 }} sideToMove="white" />);
    const fill = screen.getByTestId('evaluation-bar-fill');
    const height = Number.parseFloat((fill.style.height ?? '0%').replace('%', ''));
    expect(height).toBeGreaterThan(90);
  });

  it('fills low when White is worse', () => {
    render(<EvaluationBar evaluation={{ cp: -3000 }} sideToMove="white" />);
    const fill = screen.getByTestId('evaluation-bar-fill');
    const height = Number.parseFloat((fill.style.height ?? '0%').replace('%', ''));
    expect(height).toBeLessThan(10);
  });

  it('flips side-to-move evaluations to White before filling', () => {
    // Engine scores are from the side to move. With Black to move, a positive
    // cp means Black is better ⇒ White is worse ⇒ low White fill.
    const first = render(<EvaluationBar evaluation={{ cp: 3000 }} sideToMove="black" />);
    const blackBetter = screen.getByTestId('evaluation-bar-fill');
    expect(Number.parseFloat((blackBetter.style.height ?? '0%').replace('%', ''))).toBeLessThan(10);
    first.unmount();
    // And a negative cp for Black-to-move means White is better ⇒ high fill.
    const second = render(<EvaluationBar evaluation={{ cp: -3000 }} sideToMove="black" />);
    const whiteBetter = screen.getByTestId('evaluation-bar-fill');
    expect(Number.parseFloat((whiteBetter.style.height ?? '0%').replace('%', ''))).toBeGreaterThan(
      90,
    );
    second.unmount();
  });
});
