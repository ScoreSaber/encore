import '@/app/renderer/styles/globals.css';

import { StrictMode } from 'react';

import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';

import { getRouter } from '@/app/renderer/router';
import { applyInitialTheme } from '@/app/renderer/theme/theme-init';

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
