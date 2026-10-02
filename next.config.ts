import type { NextConfig } from "next";

const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url.trim()).origin : "";
  } catch {
    return "";
  }
};

const realtimeOrigin = origin(process.env.NEXT_PUBLIC_EVENTS_REALTIME_URL);
const httpHost = process.env.NEXT_PUBLIC_EVENTS_HTTP_HOST?.trim();
const httpOrigin = httpHost ? `https://${httpHost}` : "";

/**
 * Production only: `next dev` needs eval and its own HMR socket.
 * Inline scripts are required by the App Router without per-request nonces;
 * `wasm-unsafe-eval` is required by the Rapier physics engine.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${realtimeOrigin} ${httpOrigin}`.replace(/\s+/g, " ").trim(),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ]
    : []),
];

/**
 * Server-side configuration that has to survive the build.
 *
 * Amplify exposes its environment variables to the build shell but not to the SSR compute
 * runtime, so a route handler reading process.env at request time finds nothing there.
 * Listing the keys here inlines their build-time values into the server bundle, which is 
 * what makes them readable in the deployed function. Empty keys are dropped rather than 
 * inlined, so an unset value falls through to whatever the runtime does provide.
 */
const RUNTIME_KEYS = ["SES_REGION", "REPORTS_TABLE", "REPORT_FROM_EMAIL", "POLLY_REGION"];
const runtimeEnv = Object.fromEntries(
  RUNTIME_KEYS.map((key) => [key, process.env[key]?.trim() ?? ""]).filter(([, value]) => value !== ""),
) as Record<string, string>;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: runtimeEnv,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // narration filenames carry a content hash, so a changed line ships as a new URL
      {
        source: "/voice/:file*.mp3",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // the manifest is the one mutable file and points at the current hashes
      {
        source: "/voice/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
