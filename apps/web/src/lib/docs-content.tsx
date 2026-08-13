import collections from "collections/browser";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import type { MDXComponents } from "mdx/types";

import { getMDXComponents } from "@/components/mdx";

export const docsContent = collections.docs.createClientLoader({
  component(page, { components }: { components?: MDXComponents }) {
    const MDX = page.default;
    const { description, full, title } = page.frontmatter;

    return (
      <DocsPage toc={page.toc} full={full}>
        <title>{`${title} | Encore Docs`}</title>
        {description ? <meta name="description" content={description} /> : null}
        <DocsTitle>{title}</DocsTitle>
        {description ? <DocsDescription>{description}</DocsDescription> : null}
        <DocsBody>
          <MDX components={components ?? getMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});
