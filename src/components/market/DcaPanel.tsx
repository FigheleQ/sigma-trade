'use client';

// ============================================================
// Zakładka „DCA" — cykliczny zakup „za X$ co tydzień".
// Lista aktywnych planów + formularz tworzenia. Faktyczny zakup wykonuje
// cron w tle (działa też gdy user nie ma otwartej apki).
// ============================================================
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useChartStore } from '@/store/chartStore';
import { useDcaStore } from '@/store/dcaStore';
import { fmtUSD } from '@/lib/portfolio/format';
import { cn } from '@/lib/utils';

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });

export default function DcaPanel() {
  const activeTicker = useChartStore((s) => s.activeTicker);

  const plans = useDcaStore((s) => s.plans);
  const loading = useDcaStore((s) => s.loading);
  const saving = useDcaStore((s) => s.saving);
  const fetchPlans = useDcaStore((s) => s.fetchPlans);
  const createPlan = useDcaStore((s) => s.createPlan);
  const deletePlan = useDcaStore((s) => s.deletePlan);

  const [ticker, setTicker] = useState('');
  const [amount, setAmount] = useState('100');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  // Prefill tickera aktualnie oglądanym instrumentem.
  useEffect(() => {
    if (activeTicker) setTicker(activeTicker);
  }, [activeTicker]);

  const submit = async () => {
    setMsg(null);
    const amountUsd = Number(amount);
    const t = ticker.toUpperCase().trim();
    if (!t) return setMsg({ type: 'err', text: 'Enter a ticker' });
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return setMsg({ type: 'err', text: 'Amount must be positive' });
    }
    const res = await createPlan({ ticker: t, amountUsd });
    if (res.ok) setMsg({ type: 'ok', text: `Plan added: ${t} for ${fmtUSD(amountUsd)}/wk` });
    else setMsg({ type: 'err', text: res.error ?? 'Error' });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" data-cy="dca-panel">
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider">
          DCA — weekly buy
        </span>
      </div>

      {/* Formularz tworzenia */}
      <div className="px-3 py-2.5 border-b border-border-subtle shrink-0 flex flex-col gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="TICKER"
          className="bg-transparent border border-border-subtle rounded px-2 py-1 font-mono text-[11px] text-gray-100 placeholder:text-zinc-600 outline-none focus:border-accent/50"
        />
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-500">$</span>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100"
            className="flex-1 w-0 bg-transparent border border-border-subtle rounded px-2 py-1 font-mono text-[11px] text-gray-100 tabular-nums outline-none focus:border-accent/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="font-mono text-[9px] text-zinc-600">/wk</span>
        </div>
        <button
          onClick={() => void submit()}
          disabled={saving}
          className={cn(
            'px-3 py-1 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors',
            saving
              ? 'bg-zinc-900 text-zinc-700 cursor-not-allowed'
              : 'bg-accent/15 text-accent hover:bg-accent/25',
          )}
        >
          {saving ? 'Adding…' : 'Add plan'}
        </button>
        {msg && (
          <span className={cn('font-mono text-[9px]', msg.type === 'ok' ? 'text-accent' : 'text-red-400')}>
            {msg.text}
          </span>
        )}
      </div>

      {/* Lista planów */}
      <div className="flex flex-col flex-1 overflow-y-auto">
        {plans.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="font-mono text-[11px] text-zinc-600 text-center">
              {loading ? 'Loading…' : 'No DCA plans.\nAdd a recurring buy above.'}
            </p>
          </div>
        ) : (
          plans.map((p) => (
            <div
              key={p.id}
              className="px-3 py-2.5 border-b border-border-subtle flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-xs font-bold text-gray-100">{p.ticker}</span>
                  <span className="font-mono text-[10px] text-accent tabular-nums">
                    {fmtUSD(p.amountUsd)}/wk
                  </span>
                </div>
                <div className="font-mono text-[9px] text-zinc-500 mt-0.5">
                  Next: {fmtDate(p.nextRunAt)}
                </div>
              </div>
              <button
                onClick={() => void deletePlan(p.id)}
                className="shrink-0 p-1 text-zinc-600 hover:text-red-400 transition-colors"
                aria-label="Delete plan"
                title="Delete plan"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
