import "./global.css";

import type { ReactNode } from "react";

import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import encoreLogo from "../../../assets/encore-logo.svg";

const geist = localFont({
  src: [
    {
      path: "../../../assets/fonts/geist-latin-400-normal.woff2",
      weight: "400",
    },
    {
      path: "../../../assets/fonts/geist-latin-500-normal.woff2",
      weight: "500",
    },
    {
      path: "../../../assets/fonts/geist-latin-600-normal.woff2",
      weight: "600",
    },
    {
      path: "../../../assets/fonts/geist-latin-700-normal.woff2",
      weight: "700",
    },
  ],
  variable: "--font-sans",
});

const geistPixel = localFont({
  src: "../../../assets/fonts/GeistPixel-Square.woff2",
  weight: "500",
  variable: "--font-pixel",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://encore.scoresaber.com"),
  title: "Encore",
  icons: {
    icon: encoreLogo.src,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#59b0f4",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark min-h-full min-w-[320px] bg-[var(--background)] ${geist.variable} ${geistPixel.variable}`}
    >
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] [font-family:var(--font-sans)]">
        {children}
      </body>
    </html>
  );
}
