import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvaluationBar } from './EvaluationBar';

describe('EvaluationBar', () => {
  it('shows no fill without an evaluation', () => {
    render(<EvaluationBar evaluation={null} bottomColor="white" sideToMove="white" />);
    expect(screen.getByTestId('evaluation-bar-fill')).not.toHaveAttribute('style');
    expect(screen.getByTestId('evaluation-bar-center')).toBeInTheDocument();
  });

  it('fills by the bottom player advantage', () => {
    render(<EvaluationBar evaluation={{ cp: 3000 }} bottomColor="white" sideToMove="white" />);
    const fill = screen.getByTestId('evaluation-bar-fill');
    const height = Number.parseFloat((fill.style.height ?? '0%').replace('%', ''));
    expect(height).toBeGreaterThan(90);
  });

  it('fills low when the bottom player is worse', () => {
    render(<EvaluationBar evaluation={{ cp: -3000 }} bottomColor="white" sideToMove="white" />);
    const fill = screen.getByTestId('evaluation-bar-fill');
    const height = Number.parseFloat((fill.style.height ?? '0%').replace('%', ''));
    expect(height).toBeLessThan(10);
  });
});
