/**
 * Board size constants and snap-to-preset helper.
 *
 * The board size is a single global value persisted to `localStorage`
 * under `chessremedy:board-size`. Every Chessboard surface in the app
 * (playground, live analysis, game review, puzzle training) reads the
 * same value.
 *
 * Snap points (240 / 320 / 480 / 640 / 800 / 1024) were chosen as
 * convenient stops for casual users; power users get exact values
 * outside the ±16 px tolerance bands.
 */

export const BOARD_SIZE_KEY = 'chessremedy:board-size';

export const BOARD_SIZE_MIN = 240;
export const BOARD_SIZE_MAX = 1024;
export const BOARD_SIZE_DEFAULT = 480;

export const BOARD_SIZE_SNAP_PRESETS = [240, 320, 480, 640, 800, 1024] as const;

export const BOARD_SIZE_SNAP_TOLERANCE_PX = 16;

export const MOBILE_BREAKPOINT_PX = 768;

export function clampBoardSize(value: number): number {
  if (!Number.isFinite(value)) {
    return BOARD_SIZE_DEFAULT;
  }
  return Math.min(BOARD_SIZE_MAX, Math.max(BOARD_SIZE_MIN, Math.round(value)));
}

/**
 * Snap a board size to the nearest preset when within ±16 px of it.
 * Outside that tolerance band the clamped exact value is returned
 * unchanged.
 */
export function snapBoardSize(value: number): number {
  const clamped = clampBoardSize(value);
  let nearest = clamped;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const preset of BOARD_SIZE_SNAP_PRESETS) {
    const delta = Math.abs(clamped - preset);
    if (delta < bestDelta) {
      bestDelta = delta;
      nearest = preset;
    }
  }
  return bestDelta <= BOARD_SIZE_SNAP_TOLERANCE_PX ? nearest : clamped;
}
