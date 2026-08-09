import { relative } from 'node:path';

export default {
   '*.{js,jsx,ts,tsx}': (files) => {
      const filteredFiles = files.filter((file) => relative(process.cwd(), file).replaceAll('\\', '/') !== 'apps/main/src/routeTree.gen.ts');
      if (filteredFiles.length === 0) return [];

      const args = filteredFiles.map((file) => JSON.stringify(file)).join(' ');

      return [`bunx oxfmt ${args}`, `bunx oxlint --fix ${args}`];
   }
};
