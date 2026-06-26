// ============================================================
// Portfolio store — Zustand
// Stan portfela + historia + loty TP/SL + składanie zleceń.
// ============================================================
import { create } from 'zustand';
import type {
  PortfolioState,
  Trade,
  OrderRequest,
  OrderResult,
  PositionLot,
} from '@/lib/portfolio/types';

interface PortfolioStore {
  portfolio: PortfolioState | null;
  trades: Trade[];
  lots: PositionLot[];
  selectedLotId: string | null;
  loading: boolean;
  tradesLoading: boolean;
  ordering: boolean;
  error: string | null;

  fetchPortfolio: () => Promise<void>;
  fetchTrades: () => Promise<void>;
  fetchLots: () => Promise<void>;
  selectLot: (lotId: string | null) => void;
  placeOrder: (
    req: OrderRequest,
  ) => Promise<{ ok: boolean; error?: string; result?: OrderResult }>;
}

export const usePortfolioStore = create<PortfolioStore>((set, get) => ({
  portfolio: null,
  trades: [],
  lots: [],
  selectedLotId: null,
  loading: false,
  // start jako true — zanim pierwszy fetchTrades się rozstrzygnie, History
  // pokazuje „Loading history…" zamiast migać „No transactions.".
  tradesLoading: true,
  ordering: false,
  error: null,

  fetchPortfolio: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/portfolio');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Błąd pobierania portfela');
      set({ portfolio: data as PortfolioState });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Błąd' });
    } finally {
      set({ loading: false });
    }
  },

  fetchTrades: async () => {
    set({ tradesLoading: true });
    try {
      const res = await fetch('/api/trades');
      if (!res.ok) return;
      const data = (await res.json()) as { trades: Trade[] };
      set({ trades: data.trades });
    } catch {
      // cicho — historia nie jest krytyczna dla działania
    } finally {
      // niezależnie od wyniku (sukces / błąd / !ok) kończymy stan ładowania;
      // przy pustych/nieudanych danych History pokaże „No transactions.".
      set({ tradesLoading: false });
    }
  },

  fetchLots: async () => {
    try {
      const res = await fetch('/api/lots');
      if (!res.ok) return;
      const data = (await res.json()) as { lots: PositionLot[] };
      set({ lots: data.lots });
    } catch {
      // cicho
    }
  },

  selectLot: (lotId) => {
    set({ selectedLotId: lotId });
  },

  placeOrder: async (req) => {
    set({ ordering: true, error: null });
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const data = await res.json();
      if (!res.ok) {
        set({ error: data.error ?? 'Błąd zlecenia' });
        return { ok: false, error: data.error ?? 'Błąd zlecenia' };
      }
      const result = data as OrderResult;
      set({ portfolio: result.portfolio, selectedLotId: null });
      void get().fetchTrades();
      void get().fetchLots();
      return { ok: true, result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Błąd';
      set({ error: msg });
      return { ok: false, error: msg };
    } finally {
      set({ ordering: false });
    }
  },
}));
