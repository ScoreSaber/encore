import '@/styles/globals.css';

import { StrictMode } from 'react';

import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';

import { getRouter } from '@/router';
import { applyInitialTheme } from '@/shared/ui-adjacent/theme-init';

const rootElement = document.getElementById('root');

if (!rootElement) {
   throw new Error('root element not found');
}

applyInitialTheme();

createRoot(rootElement).render(
   <StrictMode>
      <RouterProvider router={getRouter()} />
   </StrictMode>
);
