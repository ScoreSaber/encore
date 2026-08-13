import "../docs.css";

import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import type { Route } from "./+types/docs";

import { docsContent } from "@/lib/docs-content";
import { docsLayoutOptions } from "@/lib/docs-layout";
import { docsSource } from "@/lib/docs-source.server";

export async function loader({ params }: Route.LoaderArgs) {
  const page = docsSource.getPage(params["*"].split("/").filter(Boolean));
  if (!page) throw new Response("Not found", { status: 404 });

  return {
    path: page.path,
    pageTree: await docsSource.serializePageTree(docsSource.pageTree),
  };
}

export default function Docs({ loaderData }: Route.ComponentProps) {
  const { pageTree, path } = useFumadocsLoader(loaderData);
  const Content = docsContent.getComponent(path);

  return (
    <DocsLayout tree={pageTree} {...docsLayoutOptions()} themeSwitch={{ enabled: false }}>
      <Content />
    </DocsLayout>
  );
}
