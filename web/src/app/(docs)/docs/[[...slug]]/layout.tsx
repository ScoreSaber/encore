import "../../docs.css";

import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { Provider } from "@/components/provider";
import { docsLayoutOptions } from "@/lib/docs-layout";
import { docsSource } from "@/lib/docs-source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Provider>
      <DocsLayout
        tree={docsSource.pageTree}
        {...docsLayoutOptions()}
        themeSwitch={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </Provider>
  );
}
