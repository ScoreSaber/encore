import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { DocsBrand } from "@/components/docs-brand";
import { GitHubIcon } from "@/components/github-icon";

export function docsLayoutOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <DocsBrand />,
      url: "/",
    },
    links: [
      {
        text: "Home",
        url: "/",
        active: "url",
      },
      {
        type: "icon",
        text: "GitHub",
        label: "GitHub",
        url: "https://github.com/ScoreSaber/encore",
        external: true,
        on: "nav",
        icon: <GitHubIcon />,
      },
    ],
  };
}
