// ============================================================
// Portfel — typy współdzielone (Faza 1: akcje long-only, USD)
// ============================================================

// Wiersz tabeli `positions` + cena aktualna i P/L liczone w locie.
export interface Position {
  ticker: string;
  quantity: number;        // całe akcje
  avgEntryPrice: number;   // średnia ważona cena wejścia
  currentPrice: number;    // z cache (może być lekko nieaktualna)
  marketValue: number;     // quantity × currentPrice
  unrealizedPnL: number;   // (currentPrice − avgEntryPrice) × quantity
  unrealizedPnLPercent: number;
}

// Wpis historii — niezmienny ledger.
export interface Trade {
  id: string;
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;           // cena wykonania (zapisana na sztywno)
  realizedPnL: number | null; // wypełnione tylko przy 'sell'
  executedAt: string;      // ISO
}

// Pełny stan portfela zwracany przez GET /api/portfolio.
export interface PortfolioState {
  cash: number;
  initialBalance: number;
  positionsValue: number;  // Σ marketValue
  totalValue: number;      // cash + positionsValue
  totalPnL: number;        // totalValue − initialBalance
  totalPnLPercent: number;
  positions: Position[];
}

// Pojedyncze otwarcie pozycji (lot) z opcjonalnym TP/SL.
export interface PositionLot {
  id: string;
  ticker: string;
  quantity: number;
  entryPrice: number;
  takeProfit: number | null;
  stopLoss: number | null;
  status: 'open' | 'closed';
  openedAt: string;           // ISO
  closedAt: string | null;
  closePrice: number | null;
  closeReason: 'manual' | 'take_profit' | 'stop_loss' | null;
}

// Body POST /api/orders — podaj DOKŁADNIE jedno z:
//   • amountUsd — kup/sprzedaj „za X$" (ilość ułamkowa liczona po cenie egzekucji)
//   • quantity  — dokładna ilość akcji; m.in. pełne wyjście z pozycji
export interface OrderRequest {
  ticker: string;
  side: 'buy' | 'sell';
  amountUsd?: number;
  quantity?: number;
  takeProfit?: number;   // tylko przy buy — cena absolutna TP
  stopLoss?: number;     // tylko przy buy — cena absolutna SL
  lotId?: string;        // tylko przy sell — zamknij konkretny lot; brak = zamknij wszystko
}

// Odpowiedź POST /api/orders
export interface OrderResult {
  ok: true;
  side: 'buy' | 'sell';
  ticker: string;
  quantity: number;
  executionPrice: number;
  realizedPnL: number | null;
  portfolio: PortfolioState;
}

// ============================================================
// DCA — cykliczny zakup „za X$ co tydzień" (wyzwalany w tle przez cron)
// ============================================================
export type DcaStatus = 'active' | 'paused' | 'cancelled';

// Plan DCA (wiersz tabeli dca_plans, znormalizowany do camelCase).
export interface DcaPlan {
  id: string;
  ticker: string;
  amountUsd: number;        // budżet na jeden cykl (tygodniowy)
  status: DcaStatus;
  nextRunAt: string;        // ISO — kiedy plan jest „due"
  lastRunAt: string | null; // ISO ostatniej egzekucji (lub null)
  createdAt: string;
}

// Body POST /api/dca
export interface DcaPlanRequest {
  ticker: string;
  amountUsd: number;
}
