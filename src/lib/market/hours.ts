// ============================================================
// Godziny sesji giełdy US — pn–pt, 9:30–16:00 czasu nowojorskiego.
// Liczone w strefie America/New_York niezależnie od strefy serwera/klienta.
//
// Faza 1: używane do KOMUNIKATU (rynek zamknięty → cena nieaktualna).
// Później: do całkowitej blokady składania zleceń.
//
// Uwaga: nie uwzględnia świąt giełdowych (np. Thanksgiving) — wystarczy
// na fazę testową; docelowo można dołożyć kalendarz dni wolnych.
// ============================================================

const OPEN_MINUTES = 9 * 60 + 30; // 09:30
const CLOSE_MINUTES = 16 * 60;    // 16:00

export function isMarketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);

  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const minutes = hour * 60 + minute;
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
}
