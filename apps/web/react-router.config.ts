import type { Config } from "@react-router/dev/config";
import { createGetUrl, getSlugs } from "fumadocs-core/source";

import { readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDirectory = dirname(fileURLToPath(import.meta.url));
const temporaryBuildDirectory = join(webDirectory, ".react-router-build");
const outputDirectory = join(webDirectory, "out");
const getDocsUrl = createGetUrl("/docs");

const config: Config = {
  appDirectory: "src",
  buildDirectory: ".react-router-build",
  ssr: false,
  async prerender() {
    const files = await readdir(join(webDirectory, "content", "docs"), { recursive: true });
    const docs = files
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => getDocsUrl(getSlugs(file)));

    return ["/", "/privacy", "/api/search", ...docs];
  },
  async buildEnd() {
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(join(temporaryBuildDirectory, "client"), outputDirectory);
    await rm(temporaryBuildDirectory, { recursive: true, force: true });
  },
};

export default config;
