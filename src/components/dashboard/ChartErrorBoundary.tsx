import * as React from 'react';
import styles from './ChartErrorBoundary.module.css';

export interface ChartErrorBoundaryProps {
  readonly children: React.ReactNode;
  /** Fallback text; defaults to a generic chart-failure message. */
  readonly label?: string;
}

interface ChartErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Isolates one chart's render failure so a malformed series never blanks the
 * whole page. The fallback is plain text with an inline retry; it fabricates no
 * value and never claims the data is absent.
 */
export class ChartErrorBoundary extends React.Component<
  ChartErrorBoundaryProps,
  ChartErrorBoundaryState
> {
  override state: ChartErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ChartErrorBoundaryState {
    return { failed: true };
  }

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  override render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <div className={styles.fallback} role="alert" data-testid="chart-error">
          <p className={styles.text}>{this.props.label ?? 'This chart could not be displayed.'}</p>
          <button type="button" className={styles.retry} onClick={this.retry}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
