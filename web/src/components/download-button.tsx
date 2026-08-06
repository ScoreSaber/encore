"use client";

import { useEffect, useState } from "react";

type Platform = "Linux" | "macOS" | "Windows";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Release {
  assets: ReleaseAsset[];
}

const RELEASES_URL = "https://github.com/ScoreSaber/encore/releases";
const RELEASE_API_URL = "https://api.github.com/repos/ScoreSaber/encore/releases/latest";
const RELEASE_CACHE_KEY = "encore-latest-release";

function detectPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes("win")) return "Windows";
  if (userAgent.includes("linux") || userAgent.includes("x11")) return "Linux";
  return "macOS";
}

async function fetchLatestRelease(signal: AbortSignal): Promise<Release> {
  const cached = sessionStorage.getItem(RELEASE_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const response = await fetch(RELEASE_API_URL, { signal });
  if (!response.ok) throw new Error(`GitHub release request failed with ${response.status}`);

  const release: Release = await response.json();
  if (release.assets) sessionStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(release));

  return release;
}

function pickAsset(assets: ReleaseAsset[], platform: Platform) {
  const suffix =
    platform === "Windows"
      ? "-windows-x64.exe"
      : platform === "Linux"
        ? "-linux-x86_64.AppImage"
        : "-macos-arm64.dmg";

  return assets.find((asset) => asset.name.endsWith(suffix))?.browser_download_url;
}

function PlatformIcon({ platform }: { platform: Platform }) {
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

export function DownloadButton() {
  const [platform, setPlatform] = useState<Platform>("macOS");
  const [downloadUrl, setDownloadUrl] = useState(RELEASES_URL);

  useEffect(() => {
    const controller = new AbortController();
    const detectedPlatform = detectPlatform();
    setPlatform(detectedPlatform);

    fetchLatestRelease(controller.signal)
      .then((release) => {
        const assetUrl = pickAsset(release.assets ?? [], detectedPlatform);
        if (assetUrl) setDownloadUrl(assetUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDownloadUrl(RELEASES_URL);
      });

    return () => controller.abort();
  }, []);

  return (
    <a
      className="inline-flex min-h-8 items-center justify-center gap-[9px] rounded-[7px] border px-[13px] text-[0.82rem] font-semibold text-[#06101a] no-underline [border-color:color-mix(in_srgb,var(--accent)_72%,white)] [background:color-mix(in_srgb,var(--accent)_84%,white_16%)]"
      href={downloadUrl}
    >
      <PlatformIcon platform={platform} />
      Download for {platform}
    </a>
  );
}
