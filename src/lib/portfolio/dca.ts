// ============================================================
// DCA — czysta logika (bez I/O), współdzielona przez API i cron.
//   • WEEKLY_MS / nextWeeklyRun — przesunięcie harmonogramu o +7 dni
//   • planDcaBuy — ile CAŁYCH akcji kupić za budżet i ile reszty przenieść
// ============================================================

export const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

// Następny termin = poprzedni + 7 dni. Gdyby plan zalegał (np. rynek był
// zamknięty kilka dni), przesuwamy aż termin wypadnie w przyszłości — bez
// „nadrabiania" wielu zakupów naraz.
export function nextWeeklyRun(from: Date, now: Date = new Date()): Date {
  let next = from.getTime() + WEEKLY_MS;
  while (next <= now.getTime()) next += WEEKLY_MS;
  return new Date(next);
}

export interface DcaBuyPlan {
  quantity: number; // całe akcje do kupienia (może być 0)
  spent: number;    // quantity × price
  carry: number;    // niewykorzystana reszta budżetu → na następny cykl
}

// Handlujemy CAŁYMI akcjami: kup tyle, ile zmieści budżet (amount + carry),
// nie przekraczając dostępnego cash. Reszta budżetu przechodzi na kolejny cykl.
export function planDcaBuy(budget: number, price: number, cash: number): DcaBuyPlan {
  if (price <= 0) return { quantity: 0, spent: 0, carry: budget };

  const byBudget = Math.floor(budget / price);
  const byCash = Math.floor(cash / price);
  const quantity = Math.max(0, Math.min(byBudget, byCash));
  const spent = quantity * price;

  return { quantity, spent, carry: budget - spent };
}
