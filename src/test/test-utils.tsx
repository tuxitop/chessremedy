import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

export interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial router entries when wrapping with MemoryRouter. */
  initialEntries?: string[];
  /** When true (default), wrap the UI in MemoryRouter for route context. */
  withRouter?: boolean;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    initialEntries = ['/'],
    withRouter: shouldWrapWithRouter = true,
    ...options
  }: ProviderOptions = {},
) {
  if (!shouldWrapWithRouter) {
    return render(ui, options);
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
  return render(ui, { wrapper, ...options });
}
