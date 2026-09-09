/** Wall-clock solving-time formatting for the optional solve clock. */

/** `65000` → `1:05`; wall-clock solving time display. */
export function formatSolveTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
