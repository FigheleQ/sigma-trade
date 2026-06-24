// ============================================================
// DCA store — Zustand
// Plany cyklicznego zakupu (lista + tworzenie/usuwanie przez /api/dca).
// ============================================================
import { create } from 'zustand';
import type { DcaPlan, DcaPlanRequest } from '@/lib/portfolio/types';

interface DcaStore {
  plans: DcaPlan[];
  loading: boolean;
  saving: boolean;
  error: string | null;

  fetchPlans: () => Promise<void>;
  createPlan: (req: DcaPlanRequest) => Promise<{ ok: boolean; error?: string }>;
  deletePlan: (id: string) => Promise<void>;
}

export const useDcaStore = create<DcaStore>((set, get) => ({
  plans: [],
  loading: false,
  saving: false,
  error: null,

  fetchPlans: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/dca');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Błąd pobierania planów');
      set({ plans: (data.plans ?? []) as DcaPlan[] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Błąd' });
    } finally {
      set({ loading: false });
    }
  },

  createPlan: async (req) => {
    set({ saving: true, error: null });
    try {
      const res = await fetch('/api/dca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const data = await res.json();
      if (!res.ok) {
        set({ error: data.error ?? 'Błąd tworzenia planu' });
        return { ok: false, error: data.error ?? 'Błąd tworzenia planu' };
      }
      set((s) => ({ plans: [data.plan as DcaPlan, ...s.plans] }));
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Błąd';
      set({ error: msg });
      return { ok: false, error: msg };
    } finally {
      set({ saving: false });
    }
  },

  deletePlan: async (id) => {
    // Optymistycznie usuń z listy; przy błędzie przeładuj z serwera.
    const prev = get().plans;
    set({ plans: prev.filter((p) => p.id !== id) });
    try {
      const res = await fetch(`/api/dca?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch {
      set({ plans: prev });
    }
  },
}));
