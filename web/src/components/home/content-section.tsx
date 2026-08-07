import { ArrowDown, ChevronDown, ExternalLink, FolderOpen, Search, Trash2 } from "lucide-react";

import {
  PreviewButton,
  PreviewCheckbox,
  PreviewScrollbar,
  PreviewSearch,
  PreviewTabs,
} from "@/components/home/preview-ui";

export function ContentSection() {
  return (
    <section className="bg-[#0b0e14] px-6 py-14 text-white sm:px-10 sm:py-16">
      <div className="mx-auto grid max-w-[1440px] items-center gap-9 lg:grid-cols-[0.55fr_1.45fr] lg:gap-14">
        <div className="max-w-md">
          <h2 className="text-3xl font-medium tracking-[-0.045em] text-balance sm:text-4xl">
            Your content library
          </h2>
          <p className="mt-4 text-base leading-7 text-white/52">
            Browse what&apos;s installed, manage it or find something new
          </p>
        </div>

        <ContentPreview />
      </div>
    </section>
  );
}

function ContentPreview() {
  return (
    <div className="home-preview-panel overflow-hidden rounded-lg text-white" aria-hidden="true">
      <PreviewTabs active="Maps" />

      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex shrink-0">
            <span className="flex h-8 min-w-28 items-center justify-between gap-3 rounded-l-md border border-white/10 bg-white/[0.025] px-2.5 text-xs font-medium text-white/65">
              Modified
              <ChevronDown className="size-3.5 text-white/35" aria-hidden="true" />
            </span>
            <span className="grid size-8 place-items-center rounded-r-md border border-l-0 border-white/10 bg-white/[0.025] text-white/55">
              <ArrowDown className="size-3.5" aria-hidden="true" />
            </span>
          </div>

          <PreviewSearch />

          <PreviewButton>
            <Search className="size-3.5" aria-hidden="true" />
            Find more maps
          </PreviewButton>
        </div>

        <div className="mt-3 overflow-x-auto rounded-md border border-white/10">
          <div className="grid h-[360px] min-w-[46rem] grid-cols-[0.92fr_1.08fr]">
            <div className="relative min-w-0 overflow-hidden border-r border-white/10">
              <div className="flex min-h-10 items-center gap-3 border-b border-white/10 bg-white/[0.025] px-3 py-2 text-xs text-white/45">
                <PreviewCheckbox />
                <span>Select 1,768 maps</span>
              </div>

              <MapSkeletonRow titleWidth="w-44" metadataWidth="w-28" />
              <MapSkeletonRow titleWidth="w-36" metadataWidth="w-20" />
              <MapSkeletonRow titleWidth="w-48" metadataWidth="w-32" />

              <div className="flex min-h-16 items-center gap-3 border-b border-white/10 bg-white/[0.09] px-3 py-2">
                <PreviewCheckbox />
                <SelectedMapCover />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="truncate text-sm text-white/45">
                    <span className="font-medium text-white">
                      ninelie (REDSHiFT x Vesuvia remix)
                    </span>{" "}
                    <span>by Aimer with chelly (EGOIST)</span>
                  </p>
                  <p className="mt-1 truncate text-xs text-white/42">Mapped by Saut & Minty</p>
                </div>
              </div>

              <MapSkeletonRow titleWidth="w-40" metadataWidth="w-24" />
              <PreviewScrollbar position="quarter" />
            </div>

            <div className="relative min-w-0 overflow-hidden bg-[#07080d]">
              <div className="flex min-w-0 flex-col gap-5 p-5 pr-7">
                <div className="flex min-w-0 items-start gap-4">
                  <SelectedMapCover large />
                  <div className="min-w-0 flex-1 overflow-hidden pt-1">
                    <p className="truncate text-lg leading-tight font-semibold text-white/48">
                      <span className="text-white">ninelie (REDSHiFT x Vesuvia remix)</span>{" "}
                      <span className="font-normal">by Aimer with chelly (EGOIST)</span>
                    </p>
                    <p className="mt-1 truncate text-sm text-white/45">Mapped by Saut & Minty</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="flex gap-1">
                        <PreviewIconButton>
                          <FolderOpen className="size-4" aria-hidden="true" />
                        </PreviewIconButton>
                        <PreviewIconButton>
                          <Trash2 className="size-4" aria-hidden="true" />
                        </PreviewIconButton>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-1 text-xs text-white/52">
                        BeatSaver
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-1 text-xs text-white/52">
                        ScoreSaber
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-t border-white/10 pt-5">
                  <span className="block h-3 w-full rounded-sm bg-white/9" />
                  <span className="block h-3 w-[92%] rounded-sm bg-white/9" />
                  <span className="block h-3 w-[74%] rounded-sm bg-white/9" />
                  <span className="block h-3 w-[88%] rounded-sm bg-white/7" />
                  <span className="block h-3 w-[58%] rounded-sm bg-white/7" />
                </div>
              </div>

              <PreviewScrollbar />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapSkeletonRow({
  titleWidth,
  metadataWidth,
}: {
  titleWidth: string;
  metadataWidth: string;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-white/10 px-3 py-2">
      <PreviewCheckbox />
      <span className="size-12 shrink-0 rounded-sm bg-white/7" />
      <span className="min-w-0 flex-1 space-y-2.5">
        <span className={`block h-2.5 max-w-full rounded-sm bg-white/9 ${titleWidth}`} />
        <span className={`block h-2 max-w-full rounded-sm bg-white/6 ${metadataWidth}`} />
      </span>
    </div>
  );
}

function SelectedMapCover({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center border border-white/10 bg-[#59b0f4]/12 font-semibold text-[#8fcdfb] ${
        large ? "size-28 rounded-md text-xl" : "size-12 rounded-sm text-xs"
      }`}
    >
      NN
    </span>
  );
}

function PreviewIconButton({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.025] text-white/45">
      {children}
    </span>
  );
}
