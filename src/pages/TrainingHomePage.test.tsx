import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { TrainingHomePage } from '@/pages/TrainingHomePage';
import { trainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import { cycleFixture, setFixture } from '@/domain/training/test-support';
import { renderWithProviders } from '@/test/test-utils';

const NOW = 1_700_000_000_000;

async function renderHome(): Promise<void> {
  renderWithProviders(<TrainingHomePage />, { initialEntries: ['/puzzles'] });
  await waitFor(() => expect(screen.queryByTestId('training-home-loading')).toBeNull());
}

describe('TrainingHomePage', () => {
  it('shows an explicit empty state linking to the Game Library when no sets exist', async () => {
    await renderHome();

    expect(screen.getByTestId('training-home-empty')).toBeInTheDocument();
    expect(screen.getByText(/Puzzles must first be generated/i)).toBeInTheDocument();
    expect(screen.getByTestId('training-home-empty-games-link')).toHaveAttribute('href', '/games');
  });

  it('renders active sets as cards with count, current cycle and last activity', async () => {
    await trainingSetsRepository.create(
      setFixture({
        id: 'set-a',
        name: 'Opening drills',
        puzzleIds: ['g:1', 'g:2', 'g:3'],
        updatedAt: NOW - 5_000,
      }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle-a',
        trainingSetId: 'set-a',
        cycleNumber: 2,
        status: 'inProgress',
        startedAt: NOW,
      }),
    );

    await renderHome();

    const card = screen.getByTestId('set-card-set-a');
    expect(card).toHaveTextContent('Opening drills');
    expect(screen.getByTestId('set-card-count-set-a')).toHaveTextContent('3 puzzles');
    expect(screen.getByTestId('set-card-cycle-set-a')).toHaveTextContent('Cycle 2 · In progress');
    expect(screen.getByTestId('set-card-open-set-a')).toHaveAttribute(
      'href',
      '/puzzles/sets/set-a',
    );
  });

  it('never renders a bare zero for absent data', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set-empty', name: 'Empty set', puzzleIds: [] }),
    );

    await renderHome();

    expect(screen.getByTestId('set-card-count-set-empty')).toHaveTextContent('No puzzles yet');
    expect(screen.getByTestId('set-card-cycle-set-empty')).toHaveTextContent('No cycles yet');
    expect(screen.getByTestId('set-card-count-set-empty')).not.toHaveTextContent('0');
  });

  it('surfaces a resume banner for an in-progress cycle linking to the session', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set-b', name: 'Tactics', puzzleIds: ['g:4'] }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle-b',
        trainingSetId: 'set-b',
        cycleNumber: 3,
        status: 'inProgress',
        startedAt: NOW,
      }),
    );

    await renderHome();

    expect(screen.getByTestId('training-resume')).toBeInTheDocument();
    expect(screen.getByTestId('training-resume-link')).toHaveAttribute(
      'href',
      '/puzzles/sets/set-b/cycles/3',
    );
  });

  it('keeps archived sets behind an affordance until expanded', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set-archived', name: 'Old set', status: 'archived', puzzleIds: ['g:9'] }),
    );

    await renderHome();

    expect(screen.getByTestId('training-archived')).toBeInTheDocument();
    expect(screen.queryByTestId('set-card-set-archived')).toBeNull();

    fireEvent.click(screen.getByTestId('training-archived-toggle'));

    expect(screen.getByTestId('set-card-set-archived')).toBeInTheDocument();
    expect(screen.getByTestId('training-archived-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('serves /puzzles with the training home, not the removed interim practice host', async () => {
    await renderHome();

    expect(screen.getByTestId('training-home')).toBeInTheDocument();
    // The interim Feature-012 practice host (and its `practice:*` session) is gone.
    expect(screen.queryByTestId('puzzles-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('puzzles-practice-progress')).not.toBeInTheDocument();
  });

  it('renders sets as cards and exposes the resume banner as a live status region', async () => {
    await trainingSetsRepository.create(
      setFixture({ id: 'set-a11y', name: 'A11y set', puzzleIds: ['g:1'] }),
    );
    await trainingCyclesRepository.create(
      cycleFixture({
        id: 'cycle-a11y',
        trainingSetId: 'set-a11y',
        cycleNumber: 1,
        status: 'inProgress',
        startedAt: NOW,
      }),
    );

    await renderHome();

    // Deliberate card layout (not a shrunk table) for mobile.
    expect(screen.getByTestId('set-card-set-a11y').tagName).toBe('ARTICLE');
    // The resume banner is announced when it appears.
    expect(screen.getByTestId('training-resume')).toHaveAttribute('role', 'status');
    // Every essential action is a labelled control.
    expect(screen.getByTestId('training-new-set')).toHaveAccessibleName('New set');
    expect(screen.getByTestId('training-resume-link')).toHaveAccessibleName('Resume cycle');
  });
});
