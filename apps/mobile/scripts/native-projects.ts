import { readFile, rm, writeFile } from 'node:fs/promises';

const platform = process.env.CAPACITOR_PLATFORM_NAME;

if (platform === 'android') {
   const pluginsFile = new URL('../android/app/src/main/assets/capacitor.plugins.json', import.meta.url);
   const plugins = await readFile(pluginsFile, 'utf8');
   await writeFile(pluginsFile, plugins.replace('io.capawesome.capacitorjs.plugins.nodejs.NodejsPlugin', 'com.scoresaber.encore.EncoreNodejsPlugin'));
   await rm(new URL('../android/app/src/main/assets/public/nodejs/remote.cjs', import.meta.url), { force: true });
}

if (platform === 'ios') {
   await rm(new URL('../ios/App/App/public/nodejs/quest.cjs', import.meta.url), { force: true });
}
