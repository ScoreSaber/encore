import Image from "next/image";
import Link from "next/link";

import { BeatSaberBackground } from "@/components/beat-saber-background";
import { DownloadButton } from "@/components/download-button";
import encoreApp from "../../../assets/encore-app.png";
import encoreLogo from "../../../assets/encore-logo.svg";

export default function Home() {
  return (
    <main className="relative isolate grid h-svh place-items-center overflow-hidden px-[clamp(24px,5vw,80px)] py-[clamp(28px,4vw,56px)] max-[540px]:px-5 max-[540px]:py-9">
      <BeatSaberBackground />

      <section className="w-full max-w-[1280px]" aria-labelledby="hero-title">
        <div className="flex w-full translate-y-[6px] items-end justify-between pr-4 pl-[clamp(20px,1.875vw,30px)] max-[876px]:flex-col max-[876px]:items-center max-[876px]:px-0">
          <div className="relative flex min-w-0 translate-y-[6px] items-center justify-start gap-[clamp(2px,0.35vw,6px)] max-[540px]:flex-col">
            <Image
              className="aspect-square h-auto w-[clamp(96px,9vw,128px)] -translate-y-[7px] shrink-0 shadow-none [filter:none] max-[540px]:w-[76px]"
              src={encoreLogo}
              width={168}
              height={168}
              alt=""
              priority
            />
            <div className="min-w-0 max-[540px]:text-center">
              <div className="relative inline-block">
                <h1
                  id="hero-title"
                  className="m-0 text-[clamp(3.5625rem,5.625vw,5.125rem)] leading-[0.82] font-medium tracking-[-0.055em] [font-family:var(--font-pixel),ui-monospace,monospace] max-[540px]:text-[clamp(3.125rem,17.5vw,4.375rem)]"
                >
                  Encore
                </h1>
                <p className="absolute right-2 bottom-[calc(100%-12px)] m-0 whitespace-nowrap text-[0.7rem] font-medium tracking-[0.025em] [color:color-mix(in_srgb,var(--foreground)_32%,transparent)]">
                  by{" "}
                  <a
                    className="cursor-pointer text-inherit no-underline transition-colors duration-150 hover:text-[#ffde18] focus-visible:text-[#ffde18]"
                    href="https://scoresaber.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    ScoreSaber
                  </a>
                </p>
              </div>
              <p className="mt-[7px] ml-[clamp(4px,0.2vw,5px)] whitespace-nowrap text-[0.82rem] font-medium tracking-[0.02em] [color:color-mix(in_srgb,var(--foreground)_52%,transparent)] max-[540px]:ml-0 max-[540px]:whitespace-normal">
                A modern desktop companion for Beat Saber
              </p>
            </div>
          </div>

          <div className="flex items-end max-[876px]:mt-5 max-[876px]:items-center">
            <div className="flex flex-wrap justify-center gap-2.5">
              <DownloadButton />
              <div className="flex items-center gap-2.5">
                <a
                  className="inline-flex min-h-8 items-center justify-center gap-[9px] rounded-[7px] border border-white bg-white px-[13px] text-[0.82rem] font-semibold text-[#09090b] no-underline"
                  href="https://github.com/ScoreSaber/encore"
                  target="_blank"
                  rel="noreferrer"
                >
                  <svg className="size-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 .7A11.5 11.5 0 0 0 8.4 23c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C16.8 3.7 18 4 18 4c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.8 5.4-5.5 5.7.4.4.8 1.1.8 2.2v4.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .7Z" />
                  </svg>
                  Open source
                </a>
                <Link
                  className="inline-flex min-h-8 w-[18px] items-center justify-center bg-transparent p-0 text-[0.82rem] font-bold no-underline transition-colors [color:color-mix(in_srgb,var(--foreground)_52%,transparent)] hover:text-[var(--foreground)] focus-visible:text-[var(--foreground)]"
                  href="/docs"
                  aria-label="Documentation"
                >
                  ?
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="relative mt-[clamp(16px,1.5vw,24px)] translate-y-6 scale-[1.015] max-[876px]:hidden">
          <Image
            className="block h-auto w-full [box-shadow:0_28px_64px_-28px_rgba(0,0,0,0.75)]"
            src={encoreApp}
            width={1549}
            height={971}
            sizes="(max-width: 876px) 0px, min(1280px, calc(100vw - 10vw))"
            alt="Encore desktop app"
            priority
          />
        </div>
      </section>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[min(48vh,520px)] [background:radial-gradient(ellipse_46%_70%_at_22%_100%,rgb(89_176_244/7%),transparent_76%),radial-gradient(ellipse_42%_66%_at_78%_100%,rgb(35_108_130/5%),transparent_78%),linear-gradient(to_bottom,rgb(0_2_11/0%)_0%,rgb(0_2_11/8%)_36%,rgb(0_2_11/46%)_68%,#00020b_100%)] max-[876px]:hidden"
        aria-hidden="true"
      />
    </main>
  );
}
