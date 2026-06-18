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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl" className={`dark ${jetbrainsMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://finnhub.io" />
        <link rel="dns-prefetch" href="https://finnhub.io" />
        <link rel="preconnect" href="https://generativelanguage.googleapis.com" />
        <link rel="dns-prefetch" href="https://generativelanguage.googleapis.com" />
      </head>
      <body className="font-mono bg-bg-base text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
