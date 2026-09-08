import { describe, expect, it } from 'vitest';
import { DIFFICULTY_BUCKETS, difficultyBucketOf } from './buckets';

describe('difficultyBucketOf', () => {
  it('covers the ADR-025 buckets contiguously across 0-100', () => {
    expect(DIFFICULTY_BUCKETS).toEqual([
      { name: 'Trivial', min: 0, max: 14 },
      { name: 'Easy', min: 15, max: 34 },
      { name: 'Medium', min: 35, max: 59 },
      { name: 'Hard', min: 60, max: 79 },
      { name: 'Expert', min: 80, max: 100 },
    ]);
  });

  it('classifies boundary scores inclusively', () => {
    expect(difficultyBucketOf(0).name).toBe('Trivial');
    expect(difficultyBucketOf(14).name).toBe('Trivial');
    expect(difficultyBucketOf(15).name).toBe('Easy');
    expect(difficultyBucketOf(34).name).toBe('Easy');
    expect(difficultyBucketOf(35).name).toBe('Medium');
    expect(difficultyBucketOf(59).name).toBe('Medium');
    expect(difficultyBucketOf(60).name).toBe('Hard');
    expect(difficultyBucketOf(79).name).toBe('Hard');
    expect(difficultyBucketOf(80).name).toBe('Expert');
    expect(difficultyBucketOf(100).name).toBe('Expert');
  });

  it('clamps out-of-range scores to the nearest bucket', () => {
    expect(difficultyBucketOf(-1).name).toBe('Trivial');
    expect(difficultyBucketOf(101).name).toBe('Expert');
  });

  it('mid-range scores fall in the expected bucket', () => {
    expect(difficultyBucketOf(7).name).toBe('Trivial');
    expect(difficultyBucketOf(25).name).toBe('Easy');
    expect(difficultyBucketOf(48).name).toBe('Medium');
    expect(difficultyBucketOf(70).name).toBe('Hard');
    expect(difficultyBucketOf(92).name).toBe('Expert');
  });
});
