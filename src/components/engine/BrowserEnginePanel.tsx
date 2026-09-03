import { useEffect, useState } from 'react';
import { getBrowserEngineService } from '@/infrastructure/engine/browser';
import type { EngineService } from '@/infrastructure/engine/types';
import { EnginePanel } from './EnginePanel';

export interface BrowserEnginePanelProps {
  /** FEN of the current board position to analyze. */
  readonly fen: string | null;
}

/**
 * Resolves the shared browser engine service lazily and renders the engine
 * panel against the current board position. Only the playground uses this;
 * unit tests drive `EnginePanel` directly with a fake service.
 */
export function BrowserEnginePanel({ fen }: BrowserEnginePanelProps): React.JSX.Element {
  const [service, setService] = useState<EngineService | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getBrowserEngineService()
      .then((resolved) => {
        if (alive) setService(resolved);
      })
      .catch((err: unknown) => {
        if (alive) {
          setFailed(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <div role="alert" data-testid="engine-error">
        Engine could not be loaded: {failed}
      </div>
    );
  }

  return <EnginePanel service={service} fen={fen} />;
}
