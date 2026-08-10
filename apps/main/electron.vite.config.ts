import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { createLogger } from 'vite';

import { fileURLToPath } from 'node:url';

const logger = createLogger();
const warn = logger.warn;
const warnOnce = logger.warnOnce;

function isDependencySourceMapWarning(message: string) {
   return message.includes('Failed to load source map for') || (message.includes('Sourcemap for') && message.includes('node_modules'));
}

logger.warn = (message, options) => {
   if (isDependencySourceMapWarning(message)) return;
   warn(message, options);
};

logger.warnOnce = (message, options) => {
   if (isDependencySourceMapWarning(message)) return;
   warnOnce(message, options);
};

const srcPath = fileURLToPath(new URL('./src', import.meta.url));

const commonResolve = {
   tsconfigPaths: true,
   alias: {
      '@': srcPath
   }
};
const mainResolve = process.env.VITE_POSTHOG_PROJECT_TOKEN?.trim()
   ? commonResolve
   : {
        ...commonResolve,
        alias: {
           ...commonResolve.alias,
           'posthog-node': fileURLToPath(new URL('./src/modules/telemetry/main/posthog-unconfigured.ts', import.meta.url))
        }
     };

export default defineConfig({
   main: {
      customLogger: logger,
      resolve: mainResolve,
      build: {
         externalizeDeps: false,
         rollupOptions: {
            external: ['electron'],
            input: {
               index: fileURLToPath(new URL('./src/main.ts', import.meta.url))
            }
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
            input: {
               index: fileURLToPath(new URL('./src/preload.ts', import.meta.url))
            },
            output: {
               format: 'cjs'
            }
         }
      }
   },
   renderer: {
      customLogger: logger,
      root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
      publicDir: false,
      envPrefix: ['VITE_', 'RENDERER_VITE_'],
      resolve: commonResolve,
      plugins: [
         tanstackRouter({
            routesDirectory: fileURLToPath(new URL('./src/routes', import.meta.url)),
            generatedRouteTree: fileURLToPath(new URL('./src/routeTree.gen.ts', import.meta.url)),
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
            input: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url))
         },
         chunkSizeWarningLimit: 1600
      }
   }
});
