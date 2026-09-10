import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import type { Config } from '@lichess-org/chessground/config';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import { parsePositionFen } from '@/domain/chess';
import { Chessboard, type ChessboardHandle } from './Chessboard';

/**
 * Regression test (plan 012b fix phase): a board that mounts *event-bound but
 * not interactive* (e.g. the solve board while its async game prefix is still
 * loading — `interactive` false, `drawable` true) must still install
 * `movable.events.after` at mount. Chessground reads `movable.events.after`
 * live on every move but only installs the handler from the mount config and
 * preserves it across later `api.set` merges — so without this guard the
 * board would later accept moves (dests appear) yet never deliver `onMove`.
 */
const mocks = vi.hoisted(() => {
  const Chessground = vi.fn();
  const instances: Api[] = [];
  return { Chessground, instances };
});

vi.mock('@lichess-org/chessground', () => ({
  Chessground: mocks.Chessground,
}));

function apiStub(): Api {
  return {
    set: vi.fn(),
    setShapes: vi.fn(),
    setAutoShapes: vi.fn(),
    selectSquare: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Api;
}

function installMatchMedia(): void {
  const query = vi.fn(() => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('matchMedia', query);
}

function mountConfig(): Config | null {
  if (mocks.Chessground.mock.calls.length === 0) {
    return null;
  }
  return mocks.Chessground.mock.calls[0]![1] as Config;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('Chessboard mount event binding (plan 012b)', () => {
  beforeEach(() => {
    installMatchMedia();
    mocks.Chessground.mockImplementation(() => {
      const api = apiStub();
      mocks.instances.push(api);
      return api;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mocks.Chessground.mockReset();
    mocks.instances.length = 0;
  });

  it('binds the move handler when the board mounts drawable-but-not-interactive', () => {
    const parsed = parsePositionFen(START_FEN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    render(
      <Chessboard position={parsed.position} interactive={false} drawable onMove={() => {}} />,
    );
    const config = mountConfig();
    expect(config).not.toBeNull();
    expect(typeof config!.movable?.events?.after).toBe('function');
  });

  it('delivers onMove through the mount-bound handler after interactive turns on', () => {
    const parsed = parsePositionFen(START_FEN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const onMove = vi.fn();
    const { rerender } = render(
      <Chessboard position={parsed.position} interactive={false} drawable onMove={onMove} />,
    );
    rerender(<Chessboard position={parsed.position} interactive drawable onMove={onMove} />);
    const config = mountConfig();
    expect(typeof config!.movable?.events?.after).toBe('function');
    act(() => {
      // The third Chessground param (move metadata) is irrelevant to onMove.
      (config!.movable!.events!.after as (orig: string, dest: string) => void)('e2', 'e4');
    });
    expect(onMove).toHaveBeenCalledWith('e2', 'e4');
  });

  it('leaves the handler unbound when the board mounts fully view-only', () => {
    const parsed = parsePositionFen(START_FEN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    render(<Chessboard position={parsed.position} interactive={false} drawable={false} />);
    const config = mountConfig();
    expect(config!.movable?.events).toBeUndefined();
  });
});

describe('Chessboard drawable erase + injected shapes (solve game-move arrow)', () => {
  beforeEach(() => {
    installMatchMedia();
    mocks.Chessground.mockImplementation(() => {
      const api = apiStub();
      mocks.instances.push(api);
      return api;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mocks.Chessground.mockReset();
    mocks.instances.length = 0;
  });

  it('forwards eraseOnClick into the drawable config only when the prop is set', () => {
    const parsed = parsePositionFen(START_FEN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const { unmount } = render(
      <Chessboard position={parsed.position} drawable interactive={false} eraseOnClick />,
    );
    expect(mountConfig()!.drawable).toMatchObject({
      enabled: true,
      eraseOnMovablePieceClick: true,
    });
    unmount();

    mocks.Chessground.mockClear();
    render(<Chessboard position={parsed.position} drawable interactive={false} />);
    // Omitted: Chessground's own default governs, nothing is forced.
    expect(mountConfig()!.drawable?.eraseOnMovablePieceClick).toBeUndefined();
  });

  it('clears stale custom square classes when the highlight map is removed', () => {
    const parsed = parsePositionFen(START_FEN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const classes = new Map<Key, string>([['e4' as Key, 'solve-cls-hint']]);
    const { rerender } = render(
      <Chessboard position={parsed.position} drawable customSquareClasses={classes} />,
    );
    const api = mocks.instances[0];
    const lastSet = (): { highlight?: { custom?: Map<Key, string> } } =>
      (api!.set as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0] as {
        highlight?: { custom?: Map<Key, string> };
      };
    expect(lastSet().highlight?.custom?.get('e4' as Key)).toBe('solve-cls-hint');

    // Removing the prop must clear the map (not omit it), otherwise Chessground's
    // deep merge leaves the old square classes on the board.
    rerender(<Chessboard position={parsed.position} drawable />);
    expect(lastSet().highlight?.custom?.size).toBe(0);
  });

  it('draws caller-injected shapes through the setShapes handle like a native user arrow', () => {
    const parsed = parsePositionFen(START_FEN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const ref = { current: null } as React.RefObject<ChessboardHandle | null>;
    render(<Chessboard ref={ref} position={parsed.position} drawable />);
    const arrow = { orig: 'd2' as Key, dest: 'd4' as Key, brush: 'red' };
    act(() => {
      ref.current?.setShapes([arrow]);
    });
    const api = mocks.instances[0];
    expect(api?.setShapes).toHaveBeenCalledWith([arrow]);
  });
});
