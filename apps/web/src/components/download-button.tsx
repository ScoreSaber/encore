"use client";

import { useEffect, useState } from "react";

import { z } from "zod";

const ASSET_SUFFIXES = {
  Windows: ["-windows-x64.exe"],
  Linux: ["-linux-x86_64.AppImage"],
  "Apple silicon": ["-macos-arm64.dmg"],
  "Intel Mac": ["-macos-x64.dmg"],
  "Steam Frame": ["-steam-frame.flatpak", "-linux-arm64.AppImage"],
  Quest: ["-quest.apk"],
};

type Platform = keyof typeof ASSET_SUFFIXES;

declare global {
  interface ImportMetaEnv {
    readonly VITE_ENCORE_RELEASE_URL?: string;
  }

  interface Navigator {
    userAgentData?: {
      getHighEntropyValues(hints: ["architecture"]): Promise<{ architecture?: string }>;
    };
  }
}

const releaseSchema = z.object({
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string().url() })),
});

type Release = z.infer<typeof releaseSchema>;
type ReleaseAsset = Release["assets"][number];

const RELEASES_URL = "https://github.com/ScoreSaber/encore/releases";
const RELEASE_API_URL =
  import.meta.env.VITE_ENCORE_RELEASE_URL ??
  "https://api.github.com/repos/ScoreSaber/encore/releases/latest";
const RELEASE_CACHE_KEY = "encore-latest-release";

async function detectPlatforms(): Promise<Platform[]> {
  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes("oculusbrowser") || userAgent.includes("quest")) return ["Quest"];
  if (userAgent.includes("win")) return ["Windows"];
  if (userAgent.includes("android")) return ["Linux"];

  const hints = await navigator.userAgentData
    ?.getHighEntropyValues(["architecture"])
    .catch(() => undefined);
  const renderer = webglRenderer();

  if (!userAgent.includes("linux") && !userAgent.includes("x11")) {
    if (hints?.architecture === "arm" || /apple m\d/i.test(renderer)) return ["Apple silicon"];
    if (hints?.architecture === "x86" || /intel|amd|radeon|nvidia/i.test(renderer))
      return ["Intel Mac"];
    return ["Apple silicon", "Intel Mac"];
  }

  return userAgent.includes("aarch64") || hints?.architecture === "arm" || /adreno/i.test(renderer)
    ? ["Steam Frame"]
    : ["Linux"];
}

function webglRenderer() {
  const gl = document.createElement("canvas").getContext("webgl");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
}

let detectedPlatformsPromise: Promise<Platform[]> | null = null;
let latestReleasePromise: Promise<Release> | null = null;

function getDetectedPlatforms() {
  detectedPlatformsPromise ??= detectPlatforms();
  return detectedPlatformsPromise;
}

function getLatestRelease() {
  latestReleasePromise ??= fetchLatestRelease().catch((error) => {
    latestReleasePromise = null;
    throw error;
  });
  return latestReleasePromise;
}

async function fetchLatestRelease(): Promise<Release> {
  const cached = sessionStorage.getItem(RELEASE_CACHE_KEY);
  if (cached) {
    try {
      return releaseSchema.parse(JSON.parse(cached));
    } catch {
      sessionStorage.removeItem(RELEASE_CACHE_KEY);
    }
  }

  const response = await fetch(RELEASE_API_URL);
  if (!response.ok) throw new Error(`GitHub release request failed with ${response.status}`);

  const release = releaseSchema.parse(await response.json());
  try {
    sessionStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(release));
  } catch {}

  return release;
}

function pickAsset(assets: ReleaseAsset[], platform: Platform) {
  for (const suffix of ASSET_SUFFIXES[platform]) {
    const asset = assets.find(({ name }) => name.endsWith(suffix));
    if (asset) return asset.browser_download_url;
  }
  return RELEASES_URL;
}

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "Steam Frame" || platform === "Quest") {
    return (
      <svg className="size-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4.2a2 2 0 0 1-1.7-.9l-1.2-1.8a1 1 0 0 0-1.8 0l-1.2 1.8a2 2 0 0 1-1.7.9H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      </svg>
    );
  }

  if (platform === "Windows") {
    return (
      <svg className="size-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 5.55 10.2 4.56v6.95H3V5.55Zm8.2-1.13L21 3v8.51h-9.8V4.42ZM3 12.51h7.2v6.96L3 18.48v-5.97Zm8.2 0H21V21l-9.8-1.4v-7.09Z" />
      </svg>
    );
  }

  if (platform === "Linux") {
    return (
      <svg className="size-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.5 0c-4.2.3-3.1 4.8-3.2 6.3-.1 1.1-.3 2-1 3-1 1.1-2.2 2.8-2.8 4.6-.3.8-.4 1.7-.3 2.5-.3.3-.5.6-.7.9-.2.2-.5.3-.8.4-.3.2-.7.3-.9.7-.2.4-.1.8-.1 1.1.1.4.1.8 0 1-.2.7-.2 1.2-.1 1.5.2.3.6.5 1 .6.8.2 1.9.1 2.8.6.9.5 1.9.7 2.6.5.6-.1 1-.5 1.2-1 .6 0 1.2-.3 2.3-.3.7-.1 1.6.2 2.6.2.4.9 1.1 1.3 1.9 1.2.8-.1 1.6-.6 2.3-1.3.6-.8 1.7-1.1 2.4-1.5.3-.2.6-.5.6-.9 0-.4-.2-.8-.7-1.4-.2-.2-.3-.5-.4-.9-.1-.4-.2-.8-.5-1.1-.1-.1-.3-.2-.4-.2.4-1.3.3-2.5-.2-3.7-.5-1.4-1.5-2.6-2.2-3.5-.8-1-1.6-2-1.6-3.4.1-2.1.3-6.1-3.5-6.1h-.5Zm-2.7 7.7c.7.5 1.4.7 2.1.7.8 0 1.5-.3 2.2-.8.4 1.4 1.2 3.3 1.7 4.2.4.8 1.3 2.5 1.2 4.3-.8.2-1.4.8-1.6 1.9-.2.8-.2 1.8-.3 2.7-1.5 1-3.5 1.4-5.2.3-.2-.6-.7-1.3-1.2-2-.5-.6-1-1.2-1.7-1.7-1.1-1.8.1-4.1.8-5.4.7-1.3 1.6-2.8 2-4.2Z" />
      </svg>
    );
  }

  return (
    <svg className="size-4 -translate-y-px fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.15 6.9c-1 0-2.4-1.1-4-1-2 .1-3.9 1.2-4.9 3-2.1 3.7-.6 9.1 1.5 12.1 1 1.5 2.2 3.1 3.8 3 1.5-.1 2.1-1 3.9-1s2.4 1 4 1c1.6 0 2.7-1.5 3.7-3 1.2-1.7 1.6-3.3 1.7-3.4 0 0-3.2-1.2-3.2-4.9 0-3 2.5-4.5 2.6-4.5-1.4-2.1-3.6-2.3-4.4-2.4-2-.1-3.7 1.1-4.7 1.1Zm3.4-3.1c.8-1 1.4-2.4 1.2-3.8-1.2.1-2.7.8-3.5 1.8-.8.9-1.5 2.3-1.3 3.7 1.3.1 2.7-.7 3.6-1.7Z" />
    </svg>
  );
}

const BUTTON_CLASS_NAME =
  "inline-flex min-h-8 items-center justify-center gap-2.25 rounded-[calc(var(--spacing)*1.75)] border [border-color:color-mix(in_srgb,var(--accent)_72%,white)] px-3.25 font-semibold text-[#06101a] no-underline [background:color-mix(in_srgb,var(--accent)_84%,white_16%)]";

type DownloadState =
  | { status: "loading" }
  | { status: "ready"; platforms: Platform[]; assets: ReleaseAsset[] };

export function DownloadButton() {
  const [state, setState] = useState<DownloadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let latestPlatforms: Platform[] | null = null;
    let latestAssets: ReleaseAsset[] | null = null;

    const sync = () => {
      if (!active || !latestPlatforms || !latestAssets) return;
      setState({ status: "ready", platforms: latestPlatforms, assets: latestAssets });
    };

    void getDetectedPlatforms().then((platforms) => {
      latestPlatforms = platforms;
      sync();
    });
    getLatestRelease()
      .then((release) => {
        latestAssets = release.assets;
        sync();
      })
      .catch(() => {
        latestAssets = [];
        sync();
      });

    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <a className={BUTTON_CLASS_NAME} href={RELEASES_URL}>
        Download
      </a>
    );
  }

  return (
    <div className="flex flex-wrap justify-center gap-2.5">
      {state.platforms.map((platform) => (
        <a key={platform} className={BUTTON_CLASS_NAME} href={pickAsset(state.assets, platform)}>
          <PlatformIcon platform={platform} />
          Download for {platform}
        </a>
      ))}
    </div>
  );
}
