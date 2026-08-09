import type { ReactNode } from "react";
import { Box, ChevronDown, FolderOpen, MoreHorizontal } from "lucide-react";

import { PreviewButton, PreviewScrollbar } from "@/components/home/preview-ui";

export function SharedContentSection() {
  return (
    <section className="overflow-hidden bg-[#05070e] px-6 py-14 sm:px-10 sm:py-16">
      <div className="mx-auto grid max-w-[1440px] items-center gap-10 lg:grid-cols-[1.3fr_0.7fr] lg:gap-16">
        <div className="max-w-lg lg:order-2 lg:justify-self-end">
          <h2 className="text-3xl font-medium tracking-[-0.045em] text-balance sm:text-4xl">
            Libraries across your installs
          </h2>
          <p className="mt-4 text-base leading-7 text-white/52">
            Keep your content organised in one place, then use it across whichever Beat Saber
            installs you choose
          </p>
        </div>

        <SharedContentPreview />
      </div>
    </section>
  );
}

function SharedContentPreview() {
  return (
    <div className="home-preview-panel overflow-hidden rounded-lg text-white" aria-hidden="true">
      <div className="p-5">
        <p className="text-sm font-medium">Libraries</p>
        <div className="mt-2 flex w-full items-stretch">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-l-md border border-white/10 bg-white/[0.025] px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">Shared content</span>
                <StatusBadge>Active</StatusBadge>
              </div>
              <p className="truncate text-xs text-white/30">{"D:\\Beat Saber\\SharedContent"}</p>
            </div>
            <ChevronDown className="size-4 shrink-0 text-white/35" aria-hidden="true" />
          </div>
          <span className="grid w-9 shrink-0 place-items-center rounded-r-md border border-l-0 border-white/10 bg-white/[0.025] text-white/45">
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </span>
        </div>

        <p className="mt-5 text-sm font-medium">Installs</p>

        <div className="mt-2 flex flex-col gap-2">
          <InstallLibraryRow
            name="Beat Saber 1.44.1"
            path={"D:\\Beat Saber\\1.44.1"}
            expanded
            partial
          />
          <InstallLibraryRow name="Beat Saber 1.40.8" path={"D:\\Beat Saber\\1.40.8"} />
        </div>
      </div>
    </div>
  );
}

function InstallLibraryRow({
  name,
  path,
  expanded = false,
  partial = false,
}: {
  name: string;
  path: string;
  expanded?: boolean;
  partial?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-black/15">
      <div className="flex items-center gap-3 px-3 py-3">
        <Box className="size-4 shrink-0 text-white/35" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{name}</span>
            <StatusBadge variant={partial ? "secondary" : "default"}>
              {partial ? "Partly connected" : "Connected"}
            </StatusBadge>
          </div>
          <p className="truncate text-xs text-white/30">{path}</p>
          <p className="mt-0.5 text-xs text-white/38">
            {partial ? "6 of 7 folders use this library" : "7 of 7 folders use this library"}
          </p>
        </div>
        <PreviewButton>Disconnect</PreviewButton>
        <ChevronDown
          className={`size-4 shrink-0 text-white/35 ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </div>

      {expanded ? (
        <div className="relative h-[192px] overflow-hidden border-t border-white/8">
          <div>
            <LibraryFolderRow name="Maps" path={"Beat Saber_Data\\CustomLevels"} />
            <LibraryFolderRow name="Playlists" path="Playlists" />
            <LibraryFolderRow name="Sabers" path="CustomSabers" connected={false} />
            <LibraryFolderRow name="Platforms" path="CustomPlatforms" />
          </div>
          <PreviewScrollbar />
        </div>
      ) : null}
    </div>
  );
}

function LibraryFolderRow({
  name,
  path,
  connected = true,
}: {
  name: string;
  path: string;
  connected?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/8 py-2.5 pr-3 pl-10 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{name}</span>
          <StatusBadge variant={connected ? "default" : "outline"}>
            {connected ? "Connected" : "Not connected"}
          </StatusBadge>
        </div>
        <p className="truncate text-xs text-white/28">{path}</p>
      </div>
      <FolderOpen className="size-4 text-white/32" aria-hidden="true" />
    </div>
  );
}

function StatusBadge({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "secondary" | "outline";
}) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0 text-[10px] leading-4 font-medium ${
        variant === "default"
          ? "border-transparent bg-[#59b0f4] text-[#1c1917]"
          : variant === "secondary"
            ? "border-transparent bg-white/[0.08] text-white/80"
            : "border-white/20 bg-transparent text-white/80"
      }`}
    >
      {children}
    </span>
  );
}
