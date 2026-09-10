import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';
import { renderWithProviders } from '@/test/test-utils';

describe('ConfirmDialog', () => {
  it('names the object and spells out the consequences', () => {
    renderWithProviders(
      <ConfirmDialog
        testId="cd"
        title="Delete “Tactics”?"
        message="This cannot be undone."
        details={['2 cycles', '7 recorded attempts']}
        confirmLabel="Delete set"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete “Tactics”?');
    expect(screen.getByTestId('cd-details')).toHaveTextContent('2 cycles');
    expect(screen.getByTestId('cd-details')).toHaveTextContent('7 recorded attempts');
  });

  it('confirms and cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        testId="cd"
        title="Delete?"
        message="Gone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId('cd-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('cd-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        testId="cd"
        title="Delete?"
        message="Gone."
        confirmLabel="Delete"
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
