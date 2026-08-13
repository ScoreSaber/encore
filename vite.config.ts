import mainConfig from './apps/main/vite.config.ts';

import { fileURLToPath } from 'node:url';

export default {
   defaultPackage: './apps/main',
   customLogger: mainConfig.customLogger,
   root: mainConfig.root,
   publicDir: mainConfig.publicDir,
   envPrefix: mainConfig.envPrefix,
   plugins: mainConfig.plugins,
   server: mainConfig.server,
   build: mainConfig.build,
   resolve: {
      alias: {
         '@': fileURLToPath(new URL('./apps/main/src', import.meta.url))
      }
   },
   fmt: {
      singleQuote: true,
      trailingComma: 'none',
      printWidth: 150,
      tabWidth: 3,
      endOfLine: 'lf',
      sortImports: {
         internalPattern: ['@/'],
         customGroups: [
            {
               groupName: 'react-libs',
               elementNamePattern: ['react', 'react/**']
            },
            {
               groupName: 'app-components',
               elementNamePattern: ['@/components/**']
            }
         ],
         groups: ['side_effect', 'react-libs', 'external', ['parent', 'sibling', 'index'], 'app-components', 'internal', 'style', 'unknown']
      },
      sortTailwindcss: {},
      ignorePatterns: ['**/.source/**', '**/build/**', '**/out/**', '**/release/**', 'apps/main/src/routeTree.gen.ts'],
      overrides: [
         {
            files: ['apps/web/**'],
            options: {
               printWidth: 100,
               tabWidth: 2,
               singleQuote: false,
               trailingComma: 'all',
               sortPackageJson: true
            }
         }
      ]
   },
   lint: {
      categories: {
         correctness: 'error'
      },
      options: {
         typeAware: true,
         typeCheck: true
      },
      env: {
         browser: true,
         builtin: true
      },
      ignorePatterns: ['**/.source/**', 'apps/main/src/routeTree.gen.ts'],
      rules: {
         'typescript/no-explicit-any': 'error',
         'typescript/no-non-null-assertion': 'error',
         'vite-plus/prefer-vite-plus-imports': 'error'
      },
      overrides: [
         {
            files: [
               'apps/main/src/components/**/*.{ts,tsx}',
               'apps/main/src/renderer/**/*.{ts,tsx}',
               'apps/main/src/routes/**/*.{ts,tsx}',
               'apps/main/src/modules/*/renderer/**/*.{ts,tsx}'
            ],
            rules: {
               'no-restricted-imports': [
                  'error',
                  {
                     patterns: [
                        {
                           group: ['electron', 'electron/**', 'node:*'],
                           message: 'renderer code must use the typed preload bridge'
                        }
                     ]
                  }
               ]
            }
         }
      ],
      jsPlugins: [
         {
            name: 'vite-plus',
            specifier: 'vite-plus/oxlint-plugin'
         }
      ]
   },
   test: {
      root: fileURLToPath(new URL('.', import.meta.url)),
      include: ['apps/main/src/**/*.test.ts'],
      testTimeout: 20_000
   },
   staged: {
      '*.{css,js,json,jsonc,jsx,md,mdx,ts,tsx,yaml,yml}': 'vp fmt --write',
      '*.{js,jsx,ts,tsx}': 'vp lint --fix'
   },
   run: {
      tasks: {
         dev: {
            command: 'pnpm --filter encore dev',
            cache: false
         },
         'dev:web': {
            command: 'pnpm --filter @encore/web dev',
            cache: false
         },
         'dev:all': {
            command: 'pnpm --parallel --filter encore --filter @encore/web run dev',
            cache: false
         },
         build: {
            command: 'pnpm --filter encore build',
            env: ['VITE_POSTHOG_HOST', 'VITE_POSTHOG_PROJECT_TOKEN']
         },
         'build:web': 'pnpm --filter @encore/web build',
         'build:all': {
            command: ['vp run build', 'vp run build:web']
         },
         'build:watchdog': 'pnpm --filter encore build:watchdog',
         start: {
            command: 'pnpm --filter encore start',
            cache: false
         },
         'start:web': {
            command: 'pnpm --filter @encore/web start',
            cache: false
         },
         'electron:install': {
            command: 'pnpm --filter encore electron:install',
            cache: false
         },
         package: {
            command: 'pnpm --filter encore package',
            cache: false
         },
         'package:dir': {
            command: 'pnpm --filter encore package:dir',
            cache: false
         },
         'deploy:web': {
            command: 'pnpm --filter @encore/web run deploy',
            cache: false
         },
         verify: {
            command: ['vp check', 'vp test', 'vp run build:all']
         }
      }
   }
};
