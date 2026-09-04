import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { importJobsRepository } from './import-jobs-repository';
import { createImportJob, importJobId, markPaused, patchJob } from '@/domain/import/job';
import { DEFAULT_IMPORT_FILTERS } from '@/domain/import';

describe('importJobsRepository CRUD', () => {
  beforeEach(async () => {
    await db.importJobs.clear();
  });

  it('round-trips a job preserving the full shape', async () => {
    const job = createImportJob('lichess', 'Carlsen', DEFAULT_IMPORT_FILTERS, 1);
    const progressed = patchJob(job, { cursor: 123_456, addCounters: { seen: 3 } }, 2);
    await importJobsRepository.putJob(progressed);

    const stored = await importJobsRepository.getJob(progressed.id);
    expect(stored).toEqual(progressed);
    expect(stored!.cursor).toBe(123_456);
    expect(stored!.filters).toEqual(DEFAULT_IMPORT_FILTERS);
    expect(stored!.username).toBe('Carlsen');
  });

  it('returns undefined for a missing id', async () => {
    expect(await importJobsRepository.getJob('lichess:nobody')).toBeUndefined();
  });

  it('overwrites on put and deletes idempotently', async () => {
    const job = createImportJob('chesscom', 'Remedy', DEFAULT_IMPORT_FILTERS, 1);
    await importJobsRepository.putJob(job);
    await importJobsRepository.putJob(markPaused(job, 2));
    expect((await importJobsRepository.getJob(job.id))!.status).toBe('paused');

    await importJobsRepository.deleteJob(job.id);
    expect(await importJobsRepository.getJob(job.id)).toBeUndefined();
    await importJobsRepository.deleteJob(job.id); // idempotent
  });

  it('lists all jobs and filters by status and provider', async () => {
    const a = createImportJob('lichess', 'alpha', DEFAULT_IMPORT_FILTERS, 1);
    const b = createImportJob('chesscom', 'beta', DEFAULT_IMPORT_FILTERS, 1);
    const c = markPaused(createImportJob('lichess', 'gamma', DEFAULT_IMPORT_FILTERS, 1), 2);
    for (const job of [a, b, c]) {
      await importJobsRepository.putJob(job);
    }

    expect((await importJobsRepository.listJobs()).map((j) => j.id).sort()).toEqual(
      [a.id, b.id, c.id].sort(),
    );
    expect(
      (await importJobsRepository.listJobs({ provider: 'lichess' })).map((j) => j.id).sort(),
    ).toEqual([a.id, c.id].sort());
    expect((await importJobsRepository.listJobs({ status: 'paused' })).map((j) => j.id)).toEqual([
      c.id,
    ]);
  });

  it('derives ids that are stable across case differences', () => {
    expect(importJobId('chesscom', 'ChessRemedy')).toBe(importJobId('chesscom', 'chessremedy'));
  });
});
