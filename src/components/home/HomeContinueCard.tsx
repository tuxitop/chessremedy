import type * as React from 'react';
import { trainingCyclePath, trainingSetPath } from '@/app/routes';
import { InfoCard, type InfoCardRow } from '@/components/ui/InfoCard';
import type { HomeContinueTarget } from '@/presentation/home';

export interface HomeContinueCardProps {
  readonly target: HomeContinueTarget;
  /** Solved/total of the running cycle, when known (never fabricated). */
  readonly progress?: { readonly completed: number; readonly total: number } | null;
}

type ResolvedTarget = Exclude<HomeContinueTarget, { kind: 'none' }>;

function hrefFor(target: ResolvedTarget): string {
  return target.kind === 'cycle'
    ? trainingCyclePath(target.setId, target.cycleNumber)
    : trainingSetPath(target.setId);
}

function statusFor(target: HomeContinueTarget): string {
  switch (target.kind) {
    case 'cycle':
      return target.quickTrain
        ? 'Quick train — pick up at the next unanswered puzzle.'
        : `Cycle ${target.cycleNumber} in progress — pick up at the next unanswered puzzle.`;
    case 'block':
      return 'Open block — start the next cycle.';
    case 'set':
      return 'Continue this set.';
    case 'none':
      return '';
  }
}

/**
 * The "continue training" landmark: shown only when a target resolves. It uses
 * the shared `InfoCard` structure (title, description, info rows, accent
 * action) so it matches the Review and Resume-cycle cards. It names the target,
 * shows one line of status and links to the existing host page (which owns the
 * resume action). It never fabricates a progress number.
 */
export function HomeContinueCard({
  target,
  progress,
}: HomeContinueCardProps): React.JSX.Element | null {
  if (target.kind === 'none') {
    return null;
  }

  const rows: InfoCardRow[] = [
    { label: 'Set', value: target.label, testId: 'home-continue-label' },
  ];
  if (progress != null && progress.total > 0) {
    rows.push({
      label: 'Progress',
      value: `${progress.completed} of ${progress.total} solved`,
      testId: 'home-continue-progress-label',
    });
  }

  return (
    <InfoCard
      title="Continue training"
      titleId="home-continue-title"
      testId="home-continue"
      pill={{ label: 'In progress' }}
      description={statusFor(target)}
      descriptionTestId="home-continue-status"
      rows={rows}
      action={{ label: 'Continue', to: hrefFor(target), testId: 'home-continue-link' }}
    />
  );
}
