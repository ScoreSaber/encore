import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { createLogger } from 'vite';

import packageJson from './package.json' with { type: 'json' };

import { fileURLToPath } from 'node:url';

const logger = createLogger();
const warn = logger.warn;
const warnOnce = logger.warnOnce;

logger.warn = (message, options) => {
   if (isNoisyDependencySourcemapWarning(message)) return;
   warn(message, options);
};

logger.warnOnce = (message, options) => {
   if (isNoisyDependencySourcemapWarning(message)) return;
   warnOnce(message, options);
};

const srcPath = fileURLToPath(new URL('./src', import.meta.url));

const commonResolve = {
   tsconfigPaths: true,
   alias: {
      '@': srcPath
   }
} as const;

export default defineConfig({
   main: {
      customLogger: logger,
      resolve: commonResolve,
      build: {
         rollupOptions: {
            external: ['electron'],
            input: fileURLToPath(new URL('./src/main/index.ts', import.meta.url))
         }
      }
   },
   preload: {
      customLogger: logger,
      resolve: commonResolve,
      build: {
         externalizeDeps: false,
         rollupOptions: {
            external: ['electron'],
            input: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url))
         }
      }
   },
   renderer: {
      customLogger: logger,
      root: fileURLToPath(new URL('.', import.meta.url)),
      publicDir: fileURLToPath(new URL('./public', import.meta.url)),
      envPrefix: ['VITE_', 'RENDERER_VITE_'],
      define: {
         __ENCORE_VERSION__: JSON.stringify(packageJson.version)
      },
      resolve: commonResolve,
      plugins: [
         tanstackRouter({
            routesDirectory: './src/routes',
            generatedRouteTree: './src/routeTree.gen.ts',
            routeFileIgnorePrefix: '-',
            quoteStyle: 'single',
            semicolons: true,
            autoCodeSplitting: true
         }),
         viteReact(),
         tailwindcss()
      ],
      server: {
         sourcemapIgnoreList: (sourcePath) => sourcePath.includes('/node_modules/')
      },
      build: {
         rollupOptions: {
            input: fileURLToPath(new URL('./index.html', import.meta.url))
         },
         chunkSizeWarningLimit: 1600
      }
   }
});

function isNoisyDependencySourcemapWarning(message: string) {
   return message.includes('Failed to load source map for') || (message.includes('Sourcemap for') && message.includes('node_modules'));
}
