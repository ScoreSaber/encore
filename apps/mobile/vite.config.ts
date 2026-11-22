import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

import { fileURLToPath } from 'node:url';

export default defineConfig({
   root: fileURLToPath(new URL('./src', import.meta.url)),
   publicDir: false,
   resolve: {
      alias: {
         '@': fileURLToPath(new URL('../main/src', import.meta.url))
      }
   },
   plugins: [
      tanstackRouter({
         routesDirectory: fileURLToPath(new URL('../main/src/routes', import.meta.url)),
         generatedRouteTree: fileURLToPath(new URL('../main/src/routeTree.gen.ts', import.meta.url)),
         routeFileIgnorePrefix: '-',
         quoteStyle: 'single',
         semicolons: true,
         autoCodeSplitting: true
      }),
      viteReact(),
      tailwindcss()
   ],
   build: {
      outDir: fileURLToPath(new URL('./dist', import.meta.url)),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1600
   }
});
