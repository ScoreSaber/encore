import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  reactStrictMode: true,
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: path.resolve(import.meta.dirname, ".."),
  },
};

export default withMDX(config);
