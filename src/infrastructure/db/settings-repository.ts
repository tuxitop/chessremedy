import { db, type SettingRow } from './database';

export interface SettingsRepository {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  list<T>(): Promise<Array<{ key: string; value: T }>>;
}

class DexieSettingsRepository implements SettingsRepository {
  async get<T>(key: string): Promise<T | undefined> {
    const row = await db.settings.get(key);
    return row?.value as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const row: SettingRow<T> = { key, value, updatedAt: Date.now() };
    await db.settings.put(row);
  }

  async remove(key: string): Promise<void> {
    await db.settings.delete(key);
  }

  async list<T>(): Promise<Array<{ key: string; value: T }>> {
    const rows = await db.settings.toArray();
    return rows.map((r) => ({ key: r.key, value: r.value as T }));
  }
}

export const settingsRepository: SettingsRepository = new DexieSettingsRepository();
