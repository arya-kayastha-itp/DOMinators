// STATIC_EXPORT=1 builds plain files into out/ for the deployed control plane
// (nginx serves them; the orchestrator sits at /api on the same origin).
// Every route is client-rendered, so nothing server-side is lost.
const staticExport = process.env.STATIC_EXPORT === '1'

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // With output: 'export' the static site lands in distDir itself; its own
  // dir also keeps an export from clobbering a running `next start` (.next).
  ...(staticExport ? { output: 'export', trailingSlash: true, distDir: 'out' } : {}),
}

export default nextConfig
