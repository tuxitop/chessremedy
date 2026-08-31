import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE_DEFAULT,
  BOARD_SIZE_MAX,
  BOARD_SIZE_MIN,
  BOARD_SIZE_SNAP_PRESETS,
  BOARD_SIZE_SNAP_TOLERANCE_PX,
  clampBoardSize,
  snapBoardSize,
} from './boardSize';

describe('boardSize', () => {
  describe('clampBoardSize', () => {
    it('returns the value unchanged when in range', () => {
      expect(clampBoardSize(400)).toBe(400);
      expect(clampBoardSize(BOARD_SIZE_MIN)).toBe(BOARD_SIZE_MIN);
      expect(clampBoardSize(BOARD_SIZE_MAX)).toBe(BOARD_SIZE_MAX);
    });

    it('clamps values below the minimum', () => {
      expect(clampBoardSize(0)).toBe(BOARD_SIZE_MIN);
      expect(clampBoardSize(-100)).toBe(BOARD_SIZE_MIN);
      expect(clampBoardSize(BOARD_SIZE_MIN - 1)).toBe(BOARD_SIZE_MIN);
    });

    it('clamps values above the maximum', () => {
      expect(clampBoardSize(5000)).toBe(BOARD_SIZE_MAX);
      expect(clampBoardSize(BOARD_SIZE_MAX + 1)).toBe(BOARD_SIZE_MAX);
    });

    it('rounds to the nearest integer', () => {
      expect(clampBoardSize(400.4)).toBe(400);
      expect(clampBoardSize(400.6)).toBe(401);
    });

    it('falls back to the default for non-finite input', () => {
      expect(clampBoardSize(Number.NaN)).toBe(BOARD_SIZE_DEFAULT);
      expect(clampBoardSize(Number.POSITIVE_INFINITY)).toBe(BOARD_SIZE_DEFAULT);
      expect(clampBoardSize(Number.NEGATIVE_INFINITY)).toBe(BOARD_SIZE_DEFAULT);
    });
  });

  describe('snapBoardSize', () => {
    it('snaps to the nearest preset within tolerance', () => {
      for (const preset of BOARD_SIZE_SNAP_PRESETS) {
        // values within ±tolerance of the preset should snap to it
        expect(snapBoardSize(preset)).toBe(preset);
        expect(snapBoardSize(preset + BOARD_SIZE_SNAP_TOLERANCE_PX)).toBe(preset);
        expect(snapBoardSize(preset - BOARD_SIZE_SNAP_TOLERANCE_PX)).toBe(preset);
        // values just outside the tolerance band are returned as-is (clamped)
        expect(snapBoardSize(preset + BOARD_SIZE_SNAP_TOLERANCE_PX + 1)).toBe(
          clampBoardSize(preset + BOARD_SIZE_SNAP_TOLERANCE_PX + 1),
        );
      }
    });

    it('keeps exact values outside the tolerance band', () => {
      const mid = 500; // between presets 480 and 640
      expect(snapBoardSize(mid)).toBe(mid);
      const mid2 = 700; // between presets 640 and 800
      expect(snapBoardSize(mid2)).toBe(mid2);
    });

    it('clamps before snapping so out-of-range values land on the nearest edge preset', () => {
      expect(snapBoardSize(0)).toBe(BOARD_SIZE_MIN);
      expect(snapBoardSize(5000)).toBe(BOARD_SIZE_MAX);
    });

    it('handles the exact default value', () => {
      expect(snapBoardSize(BOARD_SIZE_DEFAULT)).toBe(BOARD_SIZE_DEFAULT);
    });
  });
});
