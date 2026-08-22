import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev-only. `next dev` rejects the HMR websocket upgrade from any origin that
  // is not localhost, and the dev client bootstrap never reaches hydration — the
  // page renders from SSR but nothing is interactive. That is what you hit when
  // testing on a phone over the LAN. Ignored by `next build`/`next start`.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
};

// Serwist is a webpack plugin; Next 16 dev defaults to Turbopack and errors when
// a webpack config is present without a turbopack one. So only wrap for the
// (webpack) production build — `next build --webpack`, see package.json — and
// leave dev as a clean Turbopack config. The SW is a build artifact anyway.
const config =
  process.env.NODE_ENV === "development"
    ? nextConfig
    : withSerwistInit({
        swSrc: "app/sw.ts",
        swDest: "public/sw.js",
      })(nextConfig);

export default config;
