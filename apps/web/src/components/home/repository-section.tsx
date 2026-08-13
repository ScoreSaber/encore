import {
  ArrowRight,
  ChevronRight,
  Download,
  ExternalLink,
  GripVertical,
  Heart,
  Link2,
  PackagePlus,
  Plus,
} from "lucide-react";
import { Link } from "react-router";

import { GitHubIcon } from "@/components/github-icon";
import {
  PreviewButton,
  PreviewCheckbox,
  PreviewScrollbar,
  PreviewSearch,
  PreviewTabs,
} from "@/components/home/preview-ui";

export function RepositorySection() {
  return (
    <section className="overflow-hidden bg-[#05070e] px-6 pt-14 pb-12 sm:px-10 sm:pt-16 sm:pb-14">
      <div className="mx-auto max-w-[1440px]">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-medium tracking-[-0.045em] text-balance sm:text-5xl">
            Custom repositories
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/52">
            While{" "}
            <a
              className="font-medium text-white/72 underline decoration-white/20 underline-offset-4 transition hover:text-white"
              href="https://beatmods.com"
              target="_blank"
              rel="noreferrer"
            >
              BeatMods
            </a>{" "}
            is still the default source for Beat Saber mods, with Encore you can install mods from
            custom repositories and keep them up to date
          </p>
          <Link
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-white/70 transition hover:text-white"
            to="/docs/modding/mod-repositories"
          >
            Learn more
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <RepositoryPreview />
      </div>
    </section>
  );
}

function RepositoryPreview() {
  return (
    <div className="relative mx-auto mt-9 max-w-[1180px] lg:min-h-[610px]" aria-hidden="true">
      <div className="home-preview-panel overflow-hidden rounded-lg lg:absolute lg:top-0 lg:left-0 lg:w-[55%]">
        <div className="border-b border-white/8 px-5 py-4">
          <p className="text-xs text-white/35">Settings</p>
          <p className="mt-0.5 text-base font-medium">Mod repositories</p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-white/55">Official</p>
          <div className="mt-2 flex items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">BeatMods</p>
              <p className="truncate text-xs text-white/30">https://beatmods.com</p>
            </div>
            <span className="flex h-5 w-9 shrink-0 items-center justify-end rounded-full bg-[#59b0f4] p-0.5">
              <span className="size-4 rounded-full bg-[#0b0b11]" />
            </span>
          </div>

          <p className="mt-5 text-xs font-medium text-white/55">Add a custom repository</p>
          <div className="mt-2 flex h-9 items-center rounded-md border border-white/12 bg-black/25 pl-3 text-xs text-white/45">
            <Link2 className="mr-2 size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">https://coolmodder.github.io/mods.json</span>
            <span className="grid h-full w-9 shrink-0 place-items-center border-l border-white/10 text-white/65">
              <Plus className="size-3.5" aria-hidden="true" />
            </span>
          </div>

          <div className="mt-3 rounded-md border border-white/10 bg-[#08090f] p-4">
            <div className="flex items-start gap-3">
              <PackagePlus className="mt-0.5 size-5 shrink-0 text-white/55" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium">Cool Mods</p>
                <p className="mt-0.5 truncate text-xs text-white/30">
                  https://coolmodder.github.io/mods.json
                </p>
                <p className="mt-2 text-xs text-white/45">By coolmodder, 2 mods</p>
                <p className="mt-1 text-xs text-white/32">Downloads come from github.com</p>
              </div>
            </div>
            <div className="mt-3 divide-y divide-white/8 border-y border-white/8 text-xs">
              <div className="flex items-center justify-between gap-3 py-2">
                <span>Cool Gameplay Mod</span>
                <span className="text-white/35">1.2.3</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span>Cool UI Tweaks</span>
                <span className="text-white/35">0.4.0</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex max-w-sm items-start gap-2 text-xs leading-5 text-white/45">
                <PreviewCheckbox checked />
                <span className="-translate-y-[3px]">
                  I understand Encore doesn&apos;t check these mods and I install them at my own
                  risk
                </span>
              </div>
              <PreviewButton variant="primary">
                <Plus className="size-3.5" aria-hidden="true" />
                Add repository
              </PreviewButton>
            </div>
          </div>
        </div>
      </div>

      <div className="home-preview-panel mt-4 overflow-hidden rounded-lg lg:absolute lg:right-0 lg:bottom-0 lg:z-10 lg:mt-0 lg:w-[66%]">
        <PreviewTabs active="Mods" />

        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <PreviewSearch />
            <PreviewButton variant="primary">
              <Download className="size-3.5" aria-hidden="true" />
              Install 1 mod
            </PreviewButton>
          </div>
          <div className="relative mt-3 overflow-hidden rounded-lg">
            <div className="grid h-[360px] grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <div className="relative min-w-0 overflow-hidden">
                <div>
                  <ModGroupHeader name="Gameplay" />
                  <ModSkeletonRow muted />
                  <ModRow name="Cool Gameplay Mod" version="1.2.3" checked active />
                  <ModSkeletonRow />
                  <ModGroupHeader name="Mods so cool they need a custom category" />
                  <ModRow name="Cool UI Tweaks" version="0.4.0" />
                  <ModSkeletonRow />
                  <ModSkeletonRow />
                  <ModSkeletonRow muted />
                </div>
                <PreviewScrollbar position="bottom" />
                <span className="pointer-events-none absolute top-px right-0 bottom-px z-20 hidden w-px bg-[#393a3e] lg:block" />
              </div>

              <div className="relative hidden min-w-0 overflow-hidden bg-[#020205] p-5 pr-7 lg:block">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[#59b0f4]/12 text-sm font-semibold text-[#8fcdfb]">
                    CM
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Cool Gameplay Mod</p>
                    <p className="mt-0.5 truncate text-xs text-white/40">
                      by coolmodder · from Cool Mods · Version 1.2.3
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-nowrap items-center gap-1.5">
                  <PreviewButton variant="primary">
                    <Download className="size-3.5" aria-hidden="true" />
                    Install
                  </PreviewButton>
                  <PreviewButton>
                    <Heart className="size-3.5" aria-hidden="true" />
                    Sponsor
                  </PreviewButton>
                  <span className="inline-flex shrink-0 items-center gap-1 px-1 text-xs whitespace-nowrap text-white/52">
                    Mod page
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 px-1 text-xs whitespace-nowrap text-white/52">
                    <GitHubIcon className="size-3.5" />
                    Source
                  </span>
                </div>
                <div className="mt-5 border-t border-white/20 pt-4">
                  <p className="text-sm leading-6 text-white/55">Does cool gameplay stuff</p>
                </div>
                <PreviewScrollbar />
              </div>
            </div>
            <span className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-1 ring-white/20 ring-inset" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModRow({
  name,
  version,
  checked = false,
  active = false,
}: {
  name: string;
  version: string;
  checked?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={`home-preview-row flex min-h-10 items-center gap-3 px-3 py-2 ${
        active ? "bg-[#292625]" : ""
      }`}
    >
      <PreviewCheckbox checked={checked} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      <span className="text-xs text-white/40">{version}</span>
    </div>
  );
}

function ModGroupHeader({ name }: { name: string }) {
  return (
    <div className="home-preview-row flex min-h-10 items-center gap-2 bg-[#0f0e13] px-2 py-2 text-xs text-white/55">
      <GripVertical className="size-3.5 text-white/35" aria-hidden="true" />
      <ChevronRight className="size-3.5 rotate-90 text-white/55" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium text-white/85">{name}</span>
    </div>
  );
}

function ModSkeletonRow({ muted = false }: { muted?: boolean }) {
  return (
    <div
      className={`home-preview-row flex min-h-10 items-center gap-3 px-3 py-2 ${
        muted ? "opacity-35" : ""
      }`}
    >
      <PreviewCheckbox />
      <span className="h-2.5 w-24 rounded-sm bg-white/8" />
      <span className="ml-auto h-2.5 w-10 rounded-sm bg-white/6" />
    </div>
  );
}
