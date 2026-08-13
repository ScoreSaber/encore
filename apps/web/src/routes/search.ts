import { createFromSource } from "fumadocs-core/search/server";

import { docsSource } from "@/lib/docs-source.server";

const search = createFromSource(docsSource);

export function loader() {
  return search.staticGET();
}
