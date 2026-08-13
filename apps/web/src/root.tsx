import "./global.css";

import type { ReactNode } from "react";

import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type LinksFunction,
  type MetaFunction,
} from "react-router";

import encoreLogoUrl from "../../../assets/logo.svg?url";

import { Provider } from "@/components/provider";

export const links: LinksFunction = () => [{ rel: "icon", href: encoreLogoUrl }];

export const meta: MetaFunction = () => [
  { title: "Encore" },
  { name: "color-scheme", content: "dark" },
  { name: "theme-color", content: "#59b0f4" },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark min-h-full min-w-[320px] bg-[var(--background)]">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-[var(--background)] [font-family:var(--font-sans)] text-[var(--foreground)]">
        <Provider>{children}</Provider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
