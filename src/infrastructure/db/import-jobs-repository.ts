import { db, type ChessRemedyDatabase } from './database';
import type { ImportJob, ImportJobStatus } from '@/domain/import/job';
import type { ImportProvider } from '@/domain/import/providerGame';

export interface ImportJobsQuery {
  readonly provider?: ImportProvider;
  readonly status?: ImportJobStatus;
}

export interface ImportJobsRepository {
  getJob(id: string): Promise<ImportJob | undefined>;
  putJob(job: ImportJob): Promise<void>;
  deleteJob(id: string): Promise<void>;
  listJobs(query?: ImportJobsQuery): Promise<readonly ImportJob[]>;
}

export class DexieImportJobsRepository implements ImportJobsRepository {
  private readonly database: ChessRemedyDatabase;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
  }

  async getJob(id: string): Promise<ImportJob | undefined> {
    return this.database.importJobs.get(id);
  }

  async putJob(job: ImportJob): Promise<void> {
    await this.database.importJobs.put(job);
  }

  async deleteJob(id: string): Promise<void> {
    await this.database.importJobs.delete(id);
  }

  async listJobs(query?: ImportJobsQuery): Promise<readonly ImportJob[]> {
    if (query?.status) {
      return this.database.importJobs.where('status').equals(query.status).toArray();
    }
    if (query?.provider) {
      return this.database.importJobs.where('provider').equals(query.provider).toArray();
    }
    return this.database.importJobs.toArray();
  }
}

export const importJobsRepository: ImportJobsRepository = new DexieImportJobsRepository();
