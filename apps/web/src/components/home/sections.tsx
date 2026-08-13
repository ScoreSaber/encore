import { ChevronDown } from "lucide-react";
import { Link } from "react-router";

import scoreSaberLogoUrl from "../../../../../assets/scoresaber.svg?url";

import { ContentSection } from "@/components/home/content-section";
import { RepositorySection } from "@/components/home/repository-section";
import { SharedContentSection } from "@/components/home/shared-content-section";

const faq = [
  {
    question: "Why?",
    answer: "Thought it'd be neat",
  },
  {
    question: "Can I migrate from BSManager?",
    answer:
      "Yes. Encore detects your BSManager versions and registers them where they already are. Nothing is copied or moved and BSManager stays installed. You can reuse its shared content too.",
  },
  {
    question: "Can I use BSManager and Encore at the same time?",
    answer:
      "Yes. Both can use the same versions and shared content. Just don't have both changing the same files at once",
  },
  {
    question: "Does Encore support Quest standalone?",
    answer:
      "Quest support is current WIP and is not available in this release. There is no release date yet.",
  },
];

export function HomeSections() {
  return (
    <div className="relative isolate bg-[var(--background)]">
      <div className="h-px bg-white/15" aria-hidden="true" />

      <div id="features" className="hidden scroll-mt-14 min-[877px]:block">
        <RepositorySection />
        <ContentSection />
        <SharedContentSection />
      </div>

      <Faq />
    </div>
  );
}

function Faq() {
  return (
    <section
      id="faq"
      className="scroll-mt-14 bg-[#0b0e14] px-6 py-14 text-white sm:px-10 sm:py-16"
      aria-labelledby="faq-heading"
    >
      <div className="mx-auto max-w-3xl">
        <h2
          id="faq-heading"
          className="text-center text-4xl font-medium tracking-[-0.045em] sm:text-5xl"
        >
          FAQ
        </h2>

        <div className="mt-8 divide-y divide-white/10 border-y border-white/10">
          {faq.map((item) => (
            <details key={item.question} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-left font-medium marker:hidden sm:py-5 sm:text-lg">
                {item.question}
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/12 text-white/45 transition group-open:rotate-180 group-open:border-white/25 group-open:text-white">
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </span>
              </summary>
              <p className="max-w-2xl pr-12 pb-5 text-sm leading-6 text-white/52 sm:text-base sm:leading-7">
                {item.answer}
              </p>
            </details>
          ))}
        </div>

        <p className="mt-7 text-center text-sm text-white/42">
          There&apos;s probably more to read{" "}
          <Link
            className="text-white/72 underline decoration-white/20 underline-offset-4 transition hover:text-white"
            to="/docs"
          >
            on the docs
          </Link>{" "}
          <small className="text-white/28">(no promises)</small>
        </p>
      </div>
    </section>
  );
}

export function HomeFooter() {
  return (
    <footer className="border-y border-white/10 bg-[#03040a]">
      <div className="mx-auto flex min-h-20 max-w-[1440px] flex-col justify-center gap-4 px-6 py-4 sm:flex-row sm:items-center sm:px-10">
        <div className="flex items-center gap-3 text-sm leading-6 text-white/38">
          <a
            className="shrink-0 transition hover:opacity-80"
            href="https://scoresaber.com"
            target="_blank"
            rel="noreferrer"
            aria-label="ScoreSaber"
          >
            <img className="size-7" src={scoreSaberLogoUrl} width={28} height={28} alt="" />
          </a>
          <p>
            © 2026{" "}
            <a
              className="transition hover:text-white/70"
              href="https://scoresaber.com"
              target="_blank"
              rel="noreferrer"
            >
              ScoreSaber
            </a>{" "}
            ·{" "}
            <a className="transition hover:text-white/70" href="#top">
              Encore
            </a>{" "}
            is{" "}
            <a
              className="transition hover:text-white/70"
              href="https://github.com/ScoreSaber/encore/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              GPL-3.0 licensed
            </a>
          </p>
        </div>

        <div className="flex flex-wrap gap-x-7 gap-y-3 text-sm text-white/38 sm:ml-auto sm:justify-end">
          <a
            className="transition hover:text-white/70"
            href="https://patreon.com/scoresaber"
            target="_blank"
            rel="noreferrer"
          >
            Patreon
          </a>
          <a
            className="transition hover:text-white/70"
            href="https://discord.scoresaber.com"
            target="_blank"
            rel="noreferrer"
          >
            Discord
          </a>
          <a
            className="transition hover:text-white/70"
            href="https://x.com/scoresaber"
            target="_blank"
            rel="noreferrer"
          >
            X
          </a>
          <a
            className="transition hover:text-white/70"
            href="https://github.com/ScoreSaber/encore"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <Link className="transition hover:text-white/70" to="/docs">
            Docs
          </Link>
          <Link className="transition hover:text-white/70" to="/privacy">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
