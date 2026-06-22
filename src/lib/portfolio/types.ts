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

// Body POST /api/orders
export interface OrderRequest {
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
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
