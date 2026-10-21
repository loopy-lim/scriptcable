import { withScriptcableAsync } from '@scriptcable/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// Async config (top-level await) so Turbopack also gets `resolveAlias` —
// Next 16 builds with Turbopack by default; `next build --webpack` uses the
// webpack hook path from the same helper.
export default withScriptcableAsync(nextConfig);
