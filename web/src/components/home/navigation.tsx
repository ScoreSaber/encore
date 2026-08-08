"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { DownloadButton } from "@/components/download-button";
import { GitHubIcon } from "@/components/github-icon";
import encoreLogo from "../../../../assets/logo.svg";

export function HomeNavigation() {
  const [featureButtonVisible, setFeatureButtonVisible] = useState(true);
  const [navVisible, setNavVisible] = useState(false);

  useEffect(() => {
    if (window.scrollY > 0) {
      setFeatureButtonVisible(false);
      return;
    }

    const hideFeatureButton = () => setFeatureButtonVisible(false);
    window.addEventListener("scroll", hideFeatureButton, {
      passive: true,
      once: true,
    });
    return () => window.removeEventListener("scroll", hideFeatureButton);
  }, []);

  useEffect(() => {
    const heroActions = document.getElementById("hero-actions");
    if (!heroActions) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        setNavVisible(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
        break;
      }
    });

    observer.observe(heroActions);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <nav
        className={`fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#05070e] transition-opacity duration-300 motion-reduce:transition-none ${
          navVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-label="Homepage"
        aria-hidden={!navVisible}
        inert={!navVisible}
      >
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-7 px-6 sm:px-10">
          <a
            className="relative inline-flex items-center gap-2 text-xl font-medium tracking-[-0.04em] [font-family:var(--font-pixel),ui-monospace,monospace]"
            href="#top"
          >
            <img className="size-6" src={encoreLogo.src} width={24} height={24} alt="" />
            <span className="relative -translate-y-0.5">
              Encore
              <span className="absolute bottom-[-0.35rem] left-0 whitespace-nowrap text-[0.5rem] leading-none font-medium tracking-normal text-white/25 [font-family:var(--font-sans),sans-serif]">
                by ScoreSaber
              </span>
            </span>
          </a>
          <div className="hidden items-center gap-6 text-sm text-white/45 sm:flex">
            <a className="hidden transition hover:text-white min-[877px]:inline" href="#features">
              Features
            </a>
            <a className="transition hover:text-white" href="#faq">
              FAQ
            </a>
            <Link className="transition hover:text-white" href="/docs">
              Docs
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-4 text-xs sm:text-[0.82rem]">
            <a
              className="hidden items-center gap-1.5 text-white/45 transition hover:text-white md:flex"
              href="https://github.com/ScoreSaber/encore"
              target="_blank"
              rel="noreferrer"
            >
              <GitHubIcon className="size-3.5" />
              GitHub
            </a>
            <div className="hidden min-[877px]:block">
              <DownloadButton />
            </div>
          </div>
        </div>
      </nav>

      <a
        className={`fixed right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 grid size-11 cursor-pointer place-items-center rounded-full border border-white/15 bg-[#08090e]/90 text-white/65 no-underline shadow-[0_8px_28px_rgb(0_0_0/35%)] backdrop-blur-md transition-[border-color,color,background-color,opacity,transform] duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-[#0d1017] hover:text-white focus-visible:border-white/35 focus-visible:text-white focus-visible:outline-none motion-reduce:transition-none max-[876px]:hidden sm:right-8 sm:bottom-[calc(2rem+env(safe-area-inset-bottom))] ${
          featureButtonVisible ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0"
        }`}
        href="#features"
        aria-label="View features"
        aria-hidden={!featureButtonVisible}
        inert={!featureButtonVisible}
        onClick={() => setFeatureButtonVisible(false)}
      >
        <ChevronDown className="size-5" aria-hidden="true" />
      </a>
    </>
  );
}
