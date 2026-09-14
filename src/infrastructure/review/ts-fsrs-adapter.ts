/**
 * Feature 020 — `ts-fsrs` scheduler adapter (infrastructure).
 *
 * The **only** module that imports the scheduler library. It maps the pure
 * domain `ScheduleState` ⇄ the library `Card` (epoch millis ⇄ `Date`) and the
 * domain `Grade` ⇄ library `Rating`, and normalizes the library `State` to the
 * three-phase domain vocabulary (`New` folds into `learning`).
 *
 * Fuzz is disabled (`enable_fuzz: false`) so the projection is deterministic,
 * idempotent and exactly rebuildable (`applyGrade === scheduleFromHistory`);
 * `SCHEDULER_PARAMS_VERSION` identifies this parameter set (ADR-035, O-6).
 */

import { Rating, State, createEmptyCard, fsrs, type Card, type Grade as FsrsGrade } from 'ts-fsrs';
import type {
  Grade as DomainGrade,
  SchedulePhase,
  ScheduleState,
  Scheduler,
} from '@/domain/review';

const GRADE_TO_RATING: Readonly<Record<DomainGrade, FsrsGrade>> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** Normalize the library state to the three-phase domain vocabulary. */
function stateToPhase(state: State): SchedulePhase {
  switch (state) {
    case State.Review:
      return 'review';
    case State.Relearning:
      return 'relearning';
    default:
      // `State.New` folds into `learning` (a zero-step learning card).
      return 'learning';
  }
}

/** Map the domain phase back to a library state. */
function phaseToState(phase: SchedulePhase): State {
  switch (phase) {
    case 'review':
      return State.Review;
    case 'relearning':
      return State.Relearning;
    default:
      return State.Learning;
  }
}

/** Map a serializable `ScheduleState` to a library `Card`. */
function toCard(state: ScheduleState): Card {
  return {
    due: new Date(state.dueAt),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningStep,
    reps: state.reps,
    lapses: state.lapses,
    state: phaseToState(state.state),
    ...(state.lastReviewedAt === null ? {} : { last_review: new Date(state.lastReviewedAt) }),
  };
}

/** Map a library `Card` back to a serializable `ScheduleState`. */
function fromCard(card: Card): ScheduleState {
  return {
    dueAt: card.due.getTime(),
    lastReviewedAt: card.last_review === undefined ? null : card.last_review.getTime(),
    state: stateToPhase(card.state),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learningStep: card.learning_steps,
  };
}

/** The `ts-fsrs`-backed `Scheduler`. Deterministic: fuzz is disabled. */
export class TsFsrsScheduler implements Scheduler {
  private readonly algorithm = fsrs({ enable_fuzz: false });

  initialState(now: number): ScheduleState {
    return fromCard(createEmptyCard(new Date(now)));
  }

  next(state: ScheduleState, grade: DomainGrade, at: number): ScheduleState {
    return fromCard(this.algorithm.next(toCard(state), new Date(at), GRADE_TO_RATING[grade]).card);
  }

  preview(state: ScheduleState, now: number): Record<DomainGrade, ScheduleState> {
    const repeat = this.algorithm.repeat(toCard(state), new Date(now));
    return {
      again: fromCard(repeat[Rating.Again].card),
      hard: fromCard(repeat[Rating.Hard].card),
      good: fromCard(repeat[Rating.Good].card),
      easy: fromCard(repeat[Rating.Easy].card),
    };
  }

  retrievability(state: ScheduleState, now: number): number {
    const value = this.algorithm.get_retrievability(toCard(state), new Date(now), false);
    return Math.max(0, Math.min(1, value));
  }
}

export const tsFsrsScheduler: Scheduler = new TsFsrsScheduler();
