import type * as React from 'react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import { formatEvaluation, formatPv } from './engineFormat';
import { evaluationFromBottom, type PlayerColor } from './evaluation';
import { EngineSettingsPopover } from './EngineSettingsPopover';
import type { AnalysisController } from './useAnalysisController';
import styles from './AnalysisPanel.module.css';

export interface AnalysisPanelProps {
  readonly controller: AnalysisController;
  readonly capabilities: EngineCapabilities;
  /** FEN of the current position (for rendering PVs). */
  readonly fen: string;
  /** Player at the bottom of the board (for eval text perspective). */
  readonly bottomColor: PlayerColor;
  /** Side to move at the current position. */
  readonly sideToMove: PlayerColor;
  /** Optional node rendered after the engine-settings gear (board settings). */
  readonly rightSlot?: React.ReactNode;
}

/**
 * Engine analysis panel: the two header rows (toggle · eval · engine version ·
 * engine-settings · board-settings / reached depth) plus engine lines,
 * progress and errors. Placed above the move list on both the live board and
 * the playground.
 */
export function AnalysisPanel({
  controller,
  capabilities,
  fen,
  bottomColor,
  sideToMove,
  rightSlot,
}: AnalysisPanelProps): React.JSX.Element {
  const { enabled, analyzing, lines, error, reachedDepth, engineLabel } = controller;

  const bestEval: EngineEvaluation | null =
    enabled && lines.length > 0 ? (lines[0]!.evaluation ?? null) : null;
  const evalText =
    bestEval === null
      ? null
      : formatEvaluation(evaluationFromBottom(bestEval, bottomColor, sideToMove));

  const visibleLines = enabled ? lines : [];
  const showIdle = !enabled;
  const statusText = !enabled
    ? 'Off'
    : analyzing
      ? 'Analyzing…'
      : engineLabel
        ? 'Ready'
        : 'Starting…';

  return (
    <section className={styles.panel} data-testid="analysis-panel" aria-label="Engine analysis">
      <div className={styles.headerRow}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={enabled ? styles.toggleOn : styles.toggleOff}
          onClick={() => controller.setEnabled(!enabled)}
          aria-label={enabled ? 'Turn engine off' : 'Turn engine on'}
          data-testid="engine-toggle"
        >
          <span className={styles.toggleKnob} />
        </button>
        <span className={styles.eval} data-testid="position-eval">
          {evalText ?? '\u2014'}
        </span>
        <span className={styles.status} data-testid="engine-status">
          {statusText}
        </span>
        <span className={styles.spacer} />
        {controller.engineLabel && (
          <span className={styles.engineVersion} data-testid="engine-version">
            {controller.engineLabel}
          </span>
        )}
        <EngineSettingsPopover
          settings={controller.settings}
          capabilities={capabilities}
          onChange={controller.setSettings}
          onApplyProfile={controller.applyProfile}
        />
        {rightSlot}
      </div>

      <div className={styles.depthRow} data-testid="engine-depth-row">
        {enabled ? (
          <span className={styles.depth}>
            {reachedDepth !== null ? `Depth: ${reachedDepth}` : 'Thinking\u2026'}
          </span>
        ) : (
          <span className={styles.depth}>Engine off</span>
        )}
        {analyzing && (
          <button
            type="button"
            className={styles.stop}
            onClick={controller.cancel}
            data-testid="engine-cancel"
          >
            Cancel
          </button>
        )}
      </div>

      {showIdle && (
        <p className={styles.hint} data-testid="engine-idle">
          Toggle the engine on to analyse this position.
        </p>
      )}

      {enabled && error && (
        <div className={styles.error} role="alert" data-testid="engine-error">
          <strong>Engine error.</strong> {error.message}
        </div>
      )}

      {visibleLines.length > 0 && (
        <div className={styles.lines} data-testid="engine-result">
          {visibleLines.map((line) => (
            <div className={styles.line} key={`${fen}|${line.multipv}`}>
              <span className={styles.lineEval} data-testid="engine-eval">
                {formatEvaluation(line.evaluation)}
              </span>
              <span className={styles.linePv} data-testid="engine-pv">
                {formatPv(fen, line.principalVariation)}
              </span>
            </div>
          ))}
          {/* Keep the configured number of lines occupied so the panel height
              is stable while the engine is still reporting them. */}
          {Array.from({ length: Math.max(0, controller.settings.lines - visibleLines.length) }).map(
            (_, index) => (
              <div
                className={styles.placeholderLine}
                aria-hidden="true"
                key={`placeholder-${index}`}
                data-testid="engine-line-placeholder"
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}
