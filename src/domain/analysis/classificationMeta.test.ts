import { describe, expect, it } from 'vitest';
import { MOVE_CLASSIFICATIONS } from '@/domain/chess';
import {
  CLASSIFICATION_LABELS,
  CLASSIFICATION_NAG,
  CLASSIFICATION_LABEL_TEXT,
  CLASSIFICATION_EXPLANATION,
  MISSED_TACTIC_NAG,
  MISSED_TACTIC_LABEL,
  MISSED_TACTIC_EXPLANATION,
  nagForClassification,
  isEmphasized,
  missedTacticMeta,
} from './classificationMeta';

describe('classificationMeta (Feature 009 canonical presentation mapping)', () => {
  it('maps each ADR-023 state to its canonical NAG (good → none)', () => {
    expect(CLASSIFICATION_NAG).toEqual({
      best: 3,
      good: null,
      inaccuracy: 6,
      mistake: 2,
      blunder: 4,
    });
    expect(nagForClassification('best')).toBe(3);
    expect(nagForClassification('good')).toBeNull();
    expect(nagForClassification('inaccuracy')).toBe(6);
    expect(nagForClassification('mistake')).toBe(2);
    expect(nagForClassification('blunder')).toBe(4);
  });

  it('emphasizes every state except the ordinary good bucket', () => {
    expect(isEmphasized('good')).toBe(false);
    for (const classification of MOVE_CLASSIFICATIONS) {
      if (classification !== 'good') {
        expect(isEmphasized(classification)).toBe(true);
      }
    }
  });

  it('keeps the canonical label order identical to the domain classification order', () => {
    expect(CLASSIFICATION_LABELS).toEqual([...MOVE_CLASSIFICATIONS]);
    expect(CLASSIFICATION_LABELS).toHaveLength(5);
    expect(new Set(CLASSIFICATION_LABELS).size).toBe(5);
  });

  it('provides deterministic label text for every state', () => {
    const labels = CLASSIFICATION_LABELS.map(
      (classification) => CLASSIFICATION_LABEL_TEXT[classification],
    );
    expect(labels).toEqual(['Best move', 'Good', 'Inaccuracy', 'Mistake', 'Blunder']);
    for (const classification of MOVE_CLASSIFICATIONS) {
      expect(CLASSIFICATION_LABEL_TEXT[classification].length).toBeGreaterThan(0);
    }
  });

  it('provides a deterministic explanation for every state', () => {
    for (const classification of MOVE_CLASSIFICATIONS) {
      expect(CLASSIFICATION_EXPLANATION[classification].length).toBeGreaterThan(0);
    }
    const read = (): string[] =>
      CLASSIFICATION_LABELS.map((classification) => CLASSIFICATION_EXPLANATION[classification]);
    expect(read()).toEqual(read());
  });

  it('covers every classification state exactly once across all tables', () => {
    const keys = (table: object): string[] => Object.keys(table).sort();
    const expected = [...MOVE_CLASSIFICATIONS].sort();
    expect(keys(CLASSIFICATION_NAG)).toEqual(expected);
    expect(keys(CLASSIFICATION_LABEL_TEXT)).toEqual(expected);
    expect(keys(CLASSIFICATION_EXPLANATION)).toEqual(expected);
  });

  it('owns the canonical missed-tactic marker (NAG 9, Feature 010)', () => {
    expect(MISSED_TACTIC_NAG).toBe(9);
    expect(MISSED_TACTIC_LABEL).toBe('Missed tactic');
    expect(MISSED_TACTIC_EXPLANATION.length).toBeGreaterThan(0);
    const meta = missedTacticMeta();
    expect(meta).toEqual({
      nag: MISSED_TACTIC_NAG,
      label: MISSED_TACTIC_LABEL,
      explanation: MISSED_TACTIC_EXPLANATION,
    });
    // The marker must not collide with any classification NAG: it renders as
    // an extra glyph alongside (never instead of) the classification.
    expect(Object.values(CLASSIFICATION_NAG)).not.toContain(MISSED_TACTIC_NAG);
  });
});
