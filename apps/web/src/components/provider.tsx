"use client";

import { lazy, type ReactNode } from "react";

import { RootProvider } from "fumadocs-ui/provider/react-router";

const SearchDialog = lazy(() => import("@/components/search"));

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ SearchDialog, preload: false }} theme={{ enabled: false }}>
      {children}
    </RootProvider>
  );
}
