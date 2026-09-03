import { useCallback, useEffect, useState } from 'react';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { SETTINGS_KEYS } from '@/config/app-config';
import {
  DEFAULT_BOARD_THEME,
  DEFAULT_PIECE_SET,
  type BoardTheme,
  type PieceSet,
} from '@/components/chessboard/themes';

/** Defaults for how new boards look (theme/pieces/coordinates/animation). */
export interface BoardAppearanceSettings {
  readonly boardTheme: BoardTheme;
  readonly pieceSet: PieceSet;
  readonly coordinates: boolean;
  readonly animation: boolean;
}

const DEFAULT_APPEARANCE: BoardAppearanceSettings = {
  boardTheme: DEFAULT_BOARD_THEME,
  pieceSet: DEFAULT_PIECE_SET,
  coordinates: true,
  animation: true,
};

export interface UseBoardAppearance {
  readonly defaults: BoardAppearanceSettings | null;
  readonly isReady: boolean;
  save(next: BoardAppearanceSettings): Promise<void>;
}

/**
 * Reads and writes the persisted board/appearance defaults (Settings page),
 * used to seed the board theme/pieces/coordinates/animation on new boards.
 */
export function useBoardAppearance(): UseBoardAppearance {
  const [defaults, setDefaults] = useState<BoardAppearanceSettings | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await settingsRepository.get<Partial<BoardAppearanceSettings>>(
        SETTINGS_KEYS.boardAppearance,
      );
      if (cancelled) return;
      setDefaults(stored ? { ...DEFAULT_APPEARANCE, ...stored } : DEFAULT_APPEARANCE);
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: BoardAppearanceSettings) => {
    setDefaults(next);
    await settingsRepository.set(SETTINGS_KEYS.boardAppearance, next);
  }, []);

  return { defaults, isReady, save };
}
