import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup the DOM after each test so cases don't leak into each other.
afterEach(() => {
  cleanup();
});

// Silence noisy test-environment output. These messages are not actionable
// inside happy-dom; React 19 + Testing Library 16 + useTheme's mount-time
// effect legitimately schedules a state update that the framework reports
// as "not wrapped in act(...)" when a test asserts on DOM attributes that
// have already settled.
const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('Another connection wants to delete database')) {
    return;
  }
  originalWarn(...args);
};

const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string') {
    if (first.includes('React Router Future Flag Warning')) return;
    if (first.includes('was not wrapped in act')) return;
  }
  originalError(...args);
};

// Recharts (<ResponsiveContainer>) and reduced-motion queries need these in
// happy-dom. Only define them when the environment does not already provide
// them, so a real browser/test runner is unaffected.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    // Report reduced motion in tests: Recharts animates by default, and
    // leaving animations on makes chart-heavy component tests slow and flaky
    // under parallel load. Charts already honour this media query.
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Reset IndexedDB between tests so Dexie does not leak state.
const indexedDB = globalThis.indexedDB;
if (indexedDB) {
  afterEach(async () => {
    const databases = (await indexedDB.databases?.()) ?? [];
    for (const db of databases) {
      if (db.name) {
        await new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(db.name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      }
    }
  });
}
