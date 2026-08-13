import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { createLogger } from 'vite-plus';

import { fileURLToPath } from 'node:url';

const logger = createLogger();
const warn = logger.warn.bind(logger);
const warnOnce = logger.warnOnce.bind(logger);

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

const appPath = fileURLToPath(new URL('.', import.meta.url));
const srcPath = fileURLToPath(new URL('./src', import.meta.url));
const rendererPath = fileURLToPath(new URL('./src/renderer', import.meta.url));
const mainOutPath = fileURLToPath(new URL('./out/main', import.meta.url));
const preloadOutPath = fileURLToPath(new URL('./out/preload', import.meta.url));
const rendererOutPath = fileURLToPath(new URL('./out/renderer', import.meta.url));

const commonResolve = {
   alias: {
      '@': srcPath
   }
};
const mainResolve = process.env.VITE_POSTHOG_PROJECT_TOKEN?.trim()
   ? commonResolve
   : {
        alias: {
           ...commonResolve.alias,
           'posthog-node': fileURLToPath(new URL('./src/modules/telemetry/main/posthog-unconfigured.ts', import.meta.url))
        }
     };

const electronPlugins = await electron({
   main: {
      entry: {
         index: fileURLToPath(new URL('./src/main.ts', import.meta.url))
      },
      onstart: async ({ startup }) => {
         const electronEnv = { ...process.env };
         delete electronEnv.ELECTRON_RUN_AS_NODE;
         await startup(undefined, { cwd: appPath, env: electronEnv });
      },
      vite: {
         customLogger: logger,
         resolve: mainResolve,
         build: {
            outDir: mainOutPath,
            rolldownOptions: {
               external: ['electron']
            }
         }
      }
   },
   preload: {
      input: {
         index: fileURLToPath(new URL('./src/preload.ts', import.meta.url))
      },
      vite: {
         customLogger: logger,
         resolve: commonResolve,
         build: {
            outDir: preloadOutPath,
            rolldownOptions: {
               external: ['electron'],
               output: {
                  format: 'cjs',
                  entryFileNames: '[name].cjs'
               }
            }
         }
      }
   }
});

export default {
   customLogger: logger,
   root: rendererPath,
   publicDir: false,
   envPrefix: ['VITE_', 'RENDERER_VITE_'],
   resolve: commonResolve,
   plugins: [
      ...electronPlugins,
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
      sourcemapIgnoreList: (sourcePath: string) => sourcePath.includes('/node_modules/')
   },
   build: {
      outDir: rendererOutPath,
      emptyOutDir: true,
      rolldownOptions: {
         input: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url))
      },
      chunkSizeWarningLimit: 1600
   }
};
