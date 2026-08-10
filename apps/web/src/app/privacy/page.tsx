import type { Metadata } from "next";
import Link from "next/link";

import { HomeFooter } from "@/components/home/sections";
import encoreLogo from "../../../../../assets/logo.svg";

export const metadata: Metadata = {
  title: "Privacy policy | Encore",
  description: "How Encore collects and uses anonymous community telemetry",
  alternates: {
    canonical: "/privacy",
  },
};

const headingClass = "mt-10 text-xl font-semibold tracking-[-0.025em] text-white first:mt-0";
const linkClass =
  "text-[#8bcaff] underline decoration-[#8bcaff]/30 underline-offset-4 transition hover:text-white";

export default function PrivacyPolicy() {
  return (
    <>
      <header className="border-b border-white/10 bg-[#05070e]">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6 sm:px-10">
          <Link
            className="inline-flex items-center gap-2 text-xl font-medium tracking-[-0.04em] [font-family:var(--font-pixel),ui-monospace,monospace]"
            href="/"
          >
            <img className="size-6" src={encoreLogo.src} width={24} height={24} alt="" />
            <span className="-translate-y-0.5">Encore</span>
          </Link>
          <Link className="text-sm text-white/50 transition hover:text-white" href="/">
            Back to Encore
          </Link>
        </div>
      </header>

      <main id="top" className="px-6 py-12 sm:px-10 sm:py-16">
        <article className="mx-auto max-w-3xl text-sm leading-7 text-white/62 sm:text-base sm:leading-8">
          <header className="border-b border-white/10 pb-8">
            <h1 className="text-4xl font-medium tracking-[-0.045em] text-white sm:text-5xl">
              Privacy policy
            </h1>
            <p className="mt-3 text-sm text-white/38">Last updated 10 August 2026</p>
          </header>

          <div className="pt-8">
            <p>
              This policy explains how ScoreSaber handles optional usage telemetry from the Encore
              desktop app. Encore is operated by ScoreSaber from Melbourne, Australia. The Encore
              website does not use analytics cookies or run separate product analytics.
            </p>

            <h2 className={headingClass}>What Encore collects</h2>
            <p className="mt-3">When telemetry is enabled, Encore sends:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-white/25">
              <li>a random installation identifier that is not linked to a ScoreSaber account;</li>
              <li>the Encore version;</li>
              <li>
                the operating system and a coarse version, such as Windows 11, Linux 6.x or macOS
                27.x. On Linux this also includes the distribution name and up to two version
                components, such as Ubuntu 24.04;
              </li>
              <li>the selected Proton build version when its own version metadata is available;</li>
              <li>
                the number of Beat Saber installs known to Encore and the active install&apos;s Beat
                Saber version;
              </li>
              <li>
                public HTTPS URLs for custom mod repositories and whether each repository is
                enabled. Encore removes query strings and fragments and does not report file URLs,
                URLs containing a username or password, IP addresses, localhost, .local addresses or
                single-label host names;
              </li>
              <li>
                an event timestamp, a random report identifier and whether the report was caused by
                a change, the weekly schedule or a refresh.
              </li>
            </ul>
            <p className="mt-4">
              Encore does not send your name, email address, ScoreSaber account, file paths, file
              contents, scores, installed mods, maps or playlists. It does not use session
              recording, advertising tracking, user profiles, location enrichment or automatic error
              capture.
            </p>

            <h2 className={headingClass}>Why and when we collect it</h2>
            <p className="mt-3">
              We use this information to understand the size and health of the Beat Saber community,
              see which game and platform versions need support and identify widely used custom
              repositories.
            </p>
            <p className="mt-4">
              Encore reports when telemetry first runs, when the collected state changes and
              otherwise about once a week. It may check once a day for a refresh request so we can
              collect a current census without waiting for the weekly report.
            </p>
            <p className="mt-4">
              Where law requires a legal basis, we rely on our legitimate interest in understanding
              compatibility and maintaining Encore. You can object to this processing by turning
              telemetry off.
            </p>

            <h2 className={headingClass}>PostHog</h2>
            <p className="mt-3">
              We use PostHog&apos;s US cloud service to receive and analyse telemetry. PostHog
              necessarily receives network information such as your IP address while handling a
              request, but Encore disables location enrichment and does not add your IP address to
              its telemetry fields. PostHog processes this information for ScoreSaber under its own{" "}
              <a
                className={linkClass}
                href="https://posthog.com/privacy"
                target="_blank"
                rel="noreferrer"
              >
                privacy policy
              </a>
              .
            </p>
            <p className="mt-4">We do not sell this information or use it for advertising.</p>

            <h2 className={headingClass}>Your choice</h2>
            <p className="mt-3">
              You can stop telemetry at any time in Encore under{" "}
              <strong className="font-medium text-white">Settings → Privacy</strong>. Turning it off
              stops census reports and refresh checks. Builds made without ScoreSaber&apos;s release
              configuration do not include Encore telemetry.
            </p>

            <h2 className={headingClass}>Retention and requests</h2>
            <p className="mt-3">
              We keep telemetry for as long as reasonably needed to compare community adoption and
              compatibility over time, then delete or aggregate it. Because the random installation
              identifier is not linked to an account, we may not be able to identify a particular
              record as yours.
            </p>
            <p className="mt-4">
              For privacy questions, requests or complaints, email{" "}
              <a className={linkClass} href="mailto:privacy@scoresaber.com">
                privacy@scoresaber.com
              </a>
              . Rights vary by country and we will handle applicable requests as required by law.
            </p>

            <h2 className={headingClass}>Changes</h2>
            <p className="mt-3">
              We may update this policy when Encore or its telemetry changes. The date at the top
              shows when this page was last updated.
            </p>
          </div>
        </article>
      </main>

      <HomeFooter />
    </>
  );
}
