// Formatery walut/procentów dla widoków portfela.

export const fmtUSD = (n: number): string =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const fmtSignedUSD = (n: number): string =>
  `${n >= 0 ? '+' : '−'}${fmtUSD(Math.abs(n))}`;

export const fmtPct = (n: number): string =>
  `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
