import type { MetadataRoute } from 'next';

// Prywatna aplikacja (paper trading) — cały ruch jest za logowaniem, więc
// jawnie blokujemy crawl. Gdy pojawi się publiczna strona marketingowa,
// dodaj tu `allow` dla jej ścieżek i wystaw sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
