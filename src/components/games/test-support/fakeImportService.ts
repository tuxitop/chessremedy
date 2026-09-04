import type { ImportCounters, ImportJob, ImportProvider } from '@/domain/import';
import {
  DEFAULT_IMPORT_FILTERS,
  createImportJob,
  importJobId,
  markCompleted,
  markFailed,
  patchJob,
} from '@/domain/import';
import type { StartImportRequest, ImportRunOptions } from '@/infrastructure/import';
import type { ImportServiceLike } from '@/hooks/useGameImport';

export interface FakeImportServiceRig {
  service: ImportServiceLike;
  /** Every start/resume/retry request recorded, in order. */
  readonly starts: StartImportRequest[];
  /** The last job produced per account id. */
  readonly jobs: Map<string, ImportJob>;
  /** Set before a call to make the run fail with this message. */
  nextError: string | null;
}

/**
 * Deterministic fake import service for component tests: runs are recorded and
 * immediately resolve to a synthetic job (configurable status/counters) — no
 * network, no repositories.
 */
export function createFakeImportService(overrides?: {
  readonly status?: ImportJob['status'];
  readonly counters?: Partial<ImportCounters>;
}): FakeImportServiceRig {
  const starts: StartImportRequest[] = [];
  const jobs = new Map<string, ImportJob>();
  const rig: FakeImportServiceRig = {
    service: null as unknown as ImportServiceLike,
    starts,
    jobs,
    nextError: null,
  };

  function buildJob(request: StartImportRequest): ImportJob {
    const base = createImportJob(request.provider, request.username, request.filters, Date.now());
    const withCounters = patchJob(
      base,
      { addCounters: { seen: 1, inserted: 1, ...(overrides?.counters ?? {}) } },
      Date.now(),
    );
    const status = overrides?.status ?? 'completed';
    return status === 'failed'
      ? markFailed(withCounters, 'Player not found. Check the username and try again.', Date.now())
      : markCompleted(withCounters, Date.now());
  }

  function record(request: StartImportRequest): void {
    starts.push(request);
  }

  const service: ImportServiceLike = {
    async listJobs() {
      return [...jobs.values()];
    },
    async getJob(provider: ImportProvider, username: string) {
      return jobs.get(importJobId(provider, username));
    },
    async removeJob(provider: ImportProvider, username: string) {
      jobs.delete(importJobId(provider, username));
    },
    async start(request: StartImportRequest, run?: ImportRunOptions) {
      record(request);
      const error = rig.nextError;
      if (error !== null) {
        rig.nextError = null;
        const failed = markFailed(
          createImportJob(request.provider, request.username, request.filters, Date.now()),
          error,
          Date.now(),
        );
        jobs.set(failed.id, failed);
        return failed;
      }
      const running = createImportJob(
        request.provider,
        request.username,
        request.filters,
        Date.now(),
      );
      run?.onProgress?.(running);
      const final = buildJob(request);
      jobs.set(final.id, final);
      run?.onProgress?.(final);
      return final;
    },
    async resume(provider: ImportProvider, username: string, run?: ImportRunOptions) {
      return service.start({ provider, username, filters: DEFAULT_IMPORT_FILTERS }, run);
    },
    async retry(provider: ImportProvider, username: string, run?: ImportRunOptions) {
      return service.start({ provider, username, filters: DEFAULT_IMPORT_FILTERS }, run);
    },
  };
  rig.service = service;
  return rig;
}
