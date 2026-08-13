import type { ReactNode } from "react";

import { Check, MoreHorizontal, RefreshCw, Search } from "lucide-react";

type ContentTab = "Mods" | "Maps" | "Models" | "Playlists";

const contentTabs: ContentTab[] = ["Mods", "Maps", "Models", "Playlists"];

export function PreviewTabs({ active }: { active: ContentTab }) {
  return (
    <div className="border-b border-white/10 px-5 pt-5">
      <div className="flex gap-6 overflow-x-auto text-sm font-medium text-white/45">
        {contentTabs.map((tab) => (
          <span
            key={tab}
            className={`pb-3 ${tab === active ? "border-b border-[#59b0f4] text-white" : ""}`}
          >
            {tab}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PreviewSearch() {
  return (
    <div className="flex h-8 min-w-40 flex-1 items-center rounded-md border border-white/15 bg-white/[0.025] text-xs text-white/40">
      <Search className="ml-2.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 px-2">Search...</span>
      <span className="grid size-8 shrink-0 place-items-center text-white/42">
        <MoreHorizontal className="size-3.5" aria-hidden="true" />
      </span>
      <span className="grid size-8 shrink-0 place-items-center text-white/42">
        <RefreshCw className="size-3.5" aria-hidden="true" />
      </span>
    </div>
  );
}

export function PreviewButton({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "primary";
}) {
  return (
    <span
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ${
        variant === "primary"
          ? "border-[#78b9f2] bg-[#78b9f2] text-[#10151b]"
          : "border-white/10 bg-white/[0.025] text-white/55"
      }`}
    >
      {children}
    </span>
  );
}

export function PreviewCheckbox({ checked = false }: { checked?: boolean }) {
  return (
    <span
      className={`grid size-4 shrink-0 place-items-center rounded-[4px] border ${
        checked ? "border-[#78b9f2] bg-[#78b9f2]" : "border-white/16 bg-black/20"
      }`}
    >
      {checked ? <Check className="size-3 text-[#10151b]" aria-hidden="true" /> : null}
    </span>
  );
}

export function PreviewScrollbar({
  position = "top",
}: {
  position?: "top" | "bottom" | "quarter";
}) {
  return (
    <span className="pointer-events-none absolute top-1 right-1 bottom-1 w-1" aria-hidden="true">
      <span
        className={`absolute inset-x-0 rounded-full bg-white/18 ${
          position === "quarter"
            ? "top-1/4 h-6"
            : position === "bottom"
              ? "bottom-10 h-6"
              : "top-0 h-20"
        }`}
      />
    </span>
  );
}
