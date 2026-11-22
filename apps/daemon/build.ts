import { build } from 'esbuild';

import { fileURLToPath } from 'node:url';

const built = await build({
   absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
   entryPoints: { quest: 'src/quest.ts', remote: 'src/remote.ts', cli: 'src/cli.ts' },
   outdir: 'dist',
   outExtension: { '.js': '.cjs' },
   bundle: true,
   platform: 'node',
   format: 'cjs',
   target: 'node18.20',
   external: ['bridge'],
   alias: { '@': fileURLToPath(new URL('../main/src', import.meta.url)) },
   sourcemap: false,
   metafile: true
});

if (Object.values(built.metafile.inputs).some((input) => input.imports.some((dependency) => dependency.path === 'electron'))) {
   throw new Error('The mobile daemon must not import Electron');
}

const remoteInputs = Object.keys(built.metafile.outputs['dist/remote.cjs']?.inputs ?? {});
const questOnly = remoteInputs.filter((input) => /lib\/android\/(?!adb-endpoint)|modules\/quest\/main\/|receiver-server|@yume-chan/.test(input));
if (remoteInputs.length === 0 || questOnly.length > 0) {
   throw new Error(`The iOS daemon must not bundle Quest or receiver code:\n${questOnly.join('\n')}`);
}
