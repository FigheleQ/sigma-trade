'use client';

import { LineChart, CandlestickChart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChartStore } from '@/store/chartStore';
import type { ChartType } from '@/lib/chart/types';

export default function ChartTypeToggle() {
  const chartType = useChartStore((s) => s.chartType);
  const setChartType = useChartStore((s) => s.setChartType);

  const options: { type: ChartType; icon: React.ReactNode; label: string }[] = [
    { type: 'line',   icon: <LineChart size={13} />,         label: 'Line' },
    { type: 'candle', icon: <CandlestickChart size={13} />,  label: 'Candle' },
  ];

  return (
    <div className="flex items-center border border-border-subtle rounded overflow-hidden">
      {options.map(({ type, icon, label }) => (
        <button
          key={type}
          onClick={() => setChartType(type)}
          title={label}
          aria-label={`Switch to ${label} chart`}
          aria-pressed={chartType === type}
          className={cn(
            'flex items-center gap-1 px-2 py-1 font-mono text-[10px] transition-colors duration-150',
            chartType === type
              ? 'bg-accent/10 text-accent border-accent'
              : 'text-zinc-600 hover:text-zinc-400',
          )}
        >
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
