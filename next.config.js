/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server actions are used throughout for mutating data via the db-bridge.
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
  },
};

module.exports = nextConfig;
