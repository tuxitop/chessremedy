import type * as React from 'react';

export function NotFoundPage(): React.JSX.Element {
  return (
    <section data-testid="not-found-page">
      <h1>404</h1>
      <p>The page you are looking for does not exist.</p>
    </section>
  );
}
