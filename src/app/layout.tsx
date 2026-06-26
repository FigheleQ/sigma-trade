import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Sigma Trade',
  description: 'Paper trading with AI agent team',
  // Aplikacja w całości za logowaniem — żaden URL nie powinien trafić
  // do indeksu wyszukiwarek. Gdy powstanie publiczny landing, nadpisze
  // to własnym `metadata.robots` na swojej trasie.
  robots: { index: false, follow: false },
  icons: {
    icon: '/coach-icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${jetbrainsMono.variable}`}>
      {/* Brak preconnect do finnhub/googleapis — te API są wołane wyłącznie
          server-side (trasy /api/*). Przeglądarka nigdy się z nimi nie łączy,
          więc preconnect tylko marnował handshaki TCP/TLS przy każdym wejściu. */}
      <body className="font-mono bg-bg-base text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
