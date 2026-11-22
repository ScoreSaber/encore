import { cp, mkdir } from 'node:fs/promises';

const destination = new URL('../dist/nodejs/', import.meta.url);

await mkdir(destination, { recursive: true });
for (const bundle of ['quest.cjs', 'remote.cjs']) {
   await cp(new URL(`../../daemon/dist/${bundle}`, import.meta.url), new URL(bundle, destination));
}
