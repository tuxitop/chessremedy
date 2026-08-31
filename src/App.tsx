import type * as React from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';

export function App(): React.JSX.Element {
  return <RouterProvider router={router} />;
}
