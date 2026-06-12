import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname),

  // Izolowany katalog buildu prod (PROD_DIST=1) — pozwala uruchomić
  // `next start` równolegle do działającego `next dev`, który trzyma `.next`.
  distDir: process.env.PROD_DIST ? '.next-prod' : '.next',

  // Reduce unused JS — tree-shake lucide icons more aggressively
  experimental: {
    optimizePackageImports: ['lucide-react', '@dnd-kit/core', '@dnd-kit/sortable'],
  },

  // Compress responses
  compress: true,
};

export default nextConfig;
