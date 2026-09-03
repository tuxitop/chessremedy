import { useEffect, useId, useRef, useState } from 'react';
import type * as React from 'react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import type { AnalysisProfile } from '@/domain/chess';
import type { LiveEngineSettings } from './engineSettings';
import { EngineConfigForm } from './EngineConfigForm';
import styles from './EngineSettingsPopover.module.css';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface EngineSettingsPopoverProps {
  readonly settings: LiveEngineSettings;
  readonly capabilities: EngineCapabilities;
  readonly onChange: (next: LiveEngineSettings) => void;
  readonly onApplyProfile: (profile: AnalysisProfile) => void;
}

/**
 * Engine settings popover for live analysis. Rendered from the analysis header
 * gear; hosts the shared engine-config form.
 */
export function EngineSettingsPopover({
  settings,
  capabilities,
  onChange,
  onApplyProfile,
}: EngineSettingsPopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const popover = popoverRef.current;
    const focusables = (): HTMLElement[] =>
      popover ? Array.from(popover.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    const first = (): HTMLElement | undefined => focusables()[0];
    const last = (): HTMLElement | undefined => focusables()[focusables().length - 1];

    const handlePointer = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (!root) return;
      if (!root.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const current = document.activeElement as HTMLElement | null;
        const index = list.indexOf(current!);
        if (event.shiftKey) {
          if (index <= 0) {
            event.preventDefault();
            last()?.focus();
          }
        } else if (index === list.length - 1 || index === -1) {
          event.preventDefault();
          first()?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    const raf = requestAnimationFrame(() => first()?.focus());
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.gear}
        onClick={() => setOpen((cur) => !cur)}
        aria-label="Engine settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={triggerId}
        data-testid="engine-settings-gear"
        title="Engine settings"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
          <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 6.5h14" />
            <circle cx="7.5" cy="6.5" r="2" fill="var(--color-surface, white)" />
            <path d="M3 13.5h14" />
            <circle cx="13" cy="13.5" r="2" fill="var(--color-surface, white)" />
          </g>
        </svg>
      </button>
      {open && (
        <div
          id={triggerId}
          ref={popoverRef}
          className={styles.popover}
          role="dialog"
          aria-label="Engine settings"
          aria-modal="true"
          data-testid="engine-settings-popover"
        >
          <EngineConfigForm
            settings={settings}
            capabilities={capabilities}
            onChange={onChange}
            onApplyProfile={onApplyProfile}
          />
        </div>
      )}
    </div>
  );
}
