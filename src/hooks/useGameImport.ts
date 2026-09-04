import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportProvider } from '@/domain/import';
import type { StartImportRequest, ImportRunOptions } from '@/infrastructure/import';
import type { ImportJob } from '@/domain/import';

/** UI-facing surface of the import service (injectable fake in tests). */
export interface ImportServiceLike {
  listJobs(): Promise<readonly ImportJob[]>;
  getJob(provider: ImportProvider, username: string): Promise<ImportJob | undefined>;
  removeJob(provider: ImportProvider, username: string): Promise<void>;
  start(request: StartImportRequest, run?: ImportRunOptions): Promise<ImportJob>;
  resume(provider: ImportProvider, username: string, run?: ImportRunOptions): Promise<ImportJob>;
  retry(provider: ImportProvider, username: string, run?: ImportRunOptions): Promise<ImportJob>;
}

export interface UseGameImport {
  /** Most recently observed job for this provider/username, if any. */
  readonly job: ImportJob | null;
  readonly isBusy: boolean;
  /** User-facing error from a failed start (profile/network/filters). */
  readonly error: string | null;
  start(request: StartImportRequest): Promise<ImportJob>;
  cancel(): void;
  /** Re-read the stored job (e.g. after an account change or page load). */
  reload(provider: ImportProvider, username: string): Promise<void>;
}

/**
 * Runs a single import to completion (or cancellation) for one account,
 * streaming progress into component state. Cancelling — or unmounting while a
 * run is active — pauses the job so it can be resumed later.
 */
export function useGameImport(service: ImportServiceLike): UseGameImport {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const setJobIfMounted = useCallback((next: ImportJob | null) => {
    if (mounted.current) {
      setJob(next);
    }
  }, []);

  const setErrorIfMounted = useCallback((message: string | null) => {
    if (mounted.current) {
      setError(message);
    }
  }, []);

  const start = useCallback(
    async (request: StartImportRequest): Promise<ImportJob> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsBusy(true);
      setErrorIfMounted(null);
      try {
        const finalJob = await service.start(request, {
          signal: controller.signal,
          onProgress: setJobIfMounted,
        });
        setJobIfMounted(finalJob);
        if (finalJob.status === 'failed' && finalJob.lastError) {
          setErrorIfMounted(finalJob.lastError);
        }
        return finalJob;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!controller.signal.aborted) {
          setErrorIfMounted(message);
        }
        throw err;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        if (mounted.current) {
          setIsBusy(false);
        }
      }
    },
    [service, setJobIfMounted, setErrorIfMounted],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const reload = useCallback(
    async (provider: ImportProvider, username: string) => {
      const trimmed = username.trim();
      if (trimmed === '') {
        setJobIfMounted(null);
        return;
      }
      const stored = await service.getJob(provider, trimmed);
      setJobIfMounted(stored ?? null);
    },
    [service, setJobIfMounted],
  );

  return { job, isBusy, error, start, cancel, reload };
}
