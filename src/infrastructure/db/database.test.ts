import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { settingsRepository } from './settings-repository';

describe('ChessRemedyDatabase', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('opens successfully', () => {
    expect(db.isOpen()).toBe(true);
  });

  it('exposes the game-analysis tables at schema version 11', () => {
    expect(db.tables.map((t) => t.name)).toEqual([
      'settings',
      'games',
      'importJobs',
      'analysisJobs',
      'analyses',
      'positionAnalysisCache',
      'analysisSummaries',
      'puzzleCandidates',
      'puzzles',
      'puzzleAttempts',
      'trainingSets',
      'trainingCycles',
    ]);
    expect(db.verno).toBe(11);
  });

  it('round-trips a primitive setting', async () => {
    await settingsRepository.set('theme', 'dark');
    expect(await settingsRepository.get<string>('theme')).toBe('dark');
  });

  it('round-trips a structured setting', async () => {
    const value = { font: 'Inter', size: 14 };
    await settingsRepository.set('display', value);
    expect(await settingsRepository.get<typeof value>('display')).toEqual(value);
  });

  it('returns undefined for missing keys', async () => {
    expect(await settingsRepository.get('missing')).toBeUndefined();
  });

  it('removes a setting', async () => {
    await settingsRepository.set('theme', 'light');
    await settingsRepository.remove('theme');
    expect(await settingsRepository.get('theme')).toBeUndefined();
  });

  it('lists all settings', async () => {
    await settingsRepository.set('a', 1);
    await settingsRepository.set('b', 'two');
    const list = await settingsRepository.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.key).sort()).toEqual(['a', 'b']);
  });

  it('overwrites an existing setting with put semantics', async () => {
    await settingsRepository.set('theme', 'light');
    await settingsRepository.set('theme', 'dark');
    expect(await settingsRepository.get<string>('theme')).toBe('dark');
  });
});
