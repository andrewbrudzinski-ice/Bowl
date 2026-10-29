/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  // The database layer reads supabase/migrations at runtime (to check the schema is up to date). That path is computed, so Next's file tracing
  // can't see it and a serverless host (Vercel) would not ship the folder: every request failed with ENOENT scandir '/var/task/supabase/migrations'.
  outputFileTracingIncludes: { "/": ["./supabase/**/*", "./src/app/fonts/*.woff"], "/**/*": ["./supabase/**/*", "./src/app/fonts/*.woff"] }, // "/" separately: "/**/*" does not match the root route
  // Server actions reject bodies over 1 MB by default, but league backups and CSV imports are allowed up to 25 MB (checked in
  // src/app/actions/admin.ts). Without this, restoring any backup over 1 MB fails with a generic "Something went wrong".
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};
export default nextConfig;
