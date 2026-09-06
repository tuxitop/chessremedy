import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { blunderGameRecords } from '@/domain/analysis/fixtures/classificationScenarios';
import type { MoveAnalysis } from '@/domain/chess';
import { EvaluationDiagram, evaluationDiagramPoints } from './EvaluationDiagram';

const RECORDS = blunderGameRecords('g1', 'a1');

/** Fixture record 3 defaults to a plain cp eval; give it the real mate shape. */
function withMatingEval(record: MoveAnalysis | undefined): MoveAnalysis {
  return { ...record!, evalAfter: { cp: null, mate: 1 } as const };
}

describe('evaluationDiagramPoints (pure mapping)', () => {
  it('builds one point per record as White winning-chance percentage', () => {
    const points = evaluationDiagramPoints(RECORDS, null);
    expect(points).toHaveLength(4);

    // 1.f3: ~equal position after → White ≈ 50%.
    expect(points[0]).toMatchObject({ ply: 0, active: false });
    expect(points[0]!.whitePercent).toBeGreaterThanOrEqual(45);
    expect(points[0]!.whitePercent).toBeLessThanOrEqual(55);

    // 2.g4 blunder: the mover is White and the position after is mate against
    // White → White's winning chances collapse to near zero.
    expect(points[2]).toMatchObject({ ply: 2, active: false });
    expect(points[2]!.whitePercent).toBeLessThanOrEqual(5);

    // Black's mating Qh4# re-expressed White-positive is nearly zero too.
    const mating = withMatingEval(RECORDS[3]);
    expect(evaluationDiagramPoints([mating], null)[0]!.whitePercent).toBeLessThanOrEqual(5);

    // Labels carry a numbered move, SAN and a White-positive evaluation.
    expect(points[0]!.label).toContain('f3');
    expect(points[2]!.label).toContain('g4');
  });

  it('marks the active ply and reports active = false when none is given', () => {
    const withActive = evaluationDiagramPoints(RECORDS, 2);
    expect(withActive[0]!.active).toBe(false);
    expect(withActive[2]!.active).toBe(true);
    expect(withActive[3]!.active).toBe(false);

    expect(evaluationDiagramPoints(RECORDS, null).every((s) => !s.active)).toBe(true);
  });

  it('plots a neutral 50% for records without an evaluation', () => {
    const [noEval] = blunderGameRecords('g2', 'a2');
    const neutral = evaluationDiagramPoints(
      [{ ...noEval!, evalAfter: { cp: null, mate: null } }],
      null,
    );
    expect(neutral[0]!.whitePercent).toBe(50);
    expect(neutral[0]!.label).not.toContain(':');
  });
});

describe('EvaluationDiagram (component)', () => {
  it('renders one clickable column per record and seeks on click', async () => {
    const onSeek = vi.fn();
    render(<EvaluationDiagram records={RECORDS} activePly={null} onSeek={onSeek} />);
    const diagram = screen.getByTestId('evaluation-diagram');
    expect(diagram).toBeInTheDocument();
    expect(within(diagram).getAllByRole('button')).toHaveLength(4);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('evaluation-diagram-segment-2'));
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it('styles the active column and carries an accessible label', () => {
    render(<EvaluationDiagram records={RECORDS} activePly={1} onSeek={() => undefined} />);
    const column = screen.getByTestId('evaluation-diagram-segment-1');
    expect(column.className).toMatch(/active/);
    expect(column).toHaveAccessibleName(/Move 1… e5/);

    const inactive = screen.getByTestId('evaluation-diagram-segment-0');
    expect(inactive.className).not.toMatch(/active/);
  });

  it('renders nothing without records', () => {
    const { container } = render(
      <EvaluationDiagram records={[]} activePly={null} onSeek={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
