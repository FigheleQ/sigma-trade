// ============================================================
// Portfolio store — Zustand
// Stan portfela + historia + składanie zleceń (przez API routes).
// ============================================================
import { create } from 'zustand';
import type {
  PortfolioState,
  Trade,
  OrderRequest,
  OrderResult,
} from '@/lib/portfolio/types';

interface PortfolioStore {
  portfolio: PortfolioState | null;
  trades: Trade[];
  loading: boolean;
  ordering: boolean;
  error: string | null;

  fetchPortfolio: () => Promise<void>;
  fetchTrades: () => Promise<void>;
  placeOrder: (
    req: OrderRequest,
  ) => Promise<{ ok: boolean; error?: string; result?: OrderResult }>;
}

export const usePortfolioStore = create<PortfolioStore>((set, get) => ({
  portfolio: null,
  trades: [],
  loading: false,
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
    try {
      const res = await fetch('/api/trades');
      if (!res.ok) return;
      const data = (await res.json()) as { trades: Trade[] };
      set({ trades: data.trades });
    } catch {
      // cicho — historia nie jest krytyczna dla działania
    }
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
      set({ portfolio: result.portfolio });
      void get().fetchTrades();
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
