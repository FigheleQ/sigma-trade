'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import {
	createChart,
	ColorType,
	AreaSeries,
	CandlestickSeries,
} from 'lightweight-charts';
import type {
	IChartApi,
	ISeriesApi,
	SeriesType,
	UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, ChartType } from '@/lib/chart/types';

// ----------------------------------------------------------------
// Data mappers — each series type expects a different shape
// ----------------------------------------------------------------

function toAreaData(candles: Candle[]) {
	return candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close }));
}

function toCandleData(candles: Candle[]) {
	return candles.map((c) => ({
		time: c.time as UTCTimestamp,
		open: c.open,
		high: c.high,
		low: c.low,
		close: c.close,
	}));
}

// ----------------------------------------------------------------
// Theme constants
// ----------------------------------------------------------------

const CHART_OPTS = {
	layout: {
		background: { type: ColorType.Solid, color: 'transparent' },
		textColor: '#71717a',
		fontFamily: 'JetBrains Mono, monospace',
	},
	grid: {
		vertLines: { color: '#18181b' },
		horzLines: { color: '#18181b' },
	},
	crosshair: { mode: 1 },
	rightPriceScale: { borderColor: '#27272a' },
	timeScale: { borderColor: '#27272a', timeVisible: true, fixLeftEdge: true, fixRightEdge: true },
} as const;

const AREA_OPTS = {
	lineColor: '#00ff88',
	lineWidth: 2 as const,
	topColor: 'rgba(0, 255, 136, 0.25)',
	bottomColor: 'rgba(0, 255, 136, 0)',
};

const CANDLE_OPTS = {
	upColor: '#00ff88',
	downColor: '#ef4444',
	borderVisible: false,
	wickUpColor: '#00ff88',
	wickDownColor: '#ef4444',
};

// ----------------------------------------------------------------
// Loading skeleton
// ----------------------------------------------------------------

function ChartSkeleton() {
	return (
		<div className='flex flex-col gap-3 p-6 h-full'>
			<div className='flex gap-2 items-end h-full'>
				{Array.from({ length: 24 }).map((_, i) => (
					<div
						key={i}
						className='flex-1 bg-zinc-800 rounded-sm animate-pulse'
						style={{ height: `${30 + Math.sin(i * 0.8) * 20 + 20}%` }}
					/>
				))}
			</div>
			<div className='h-3 w-full bg-zinc-800 rounded animate-pulse' />
		</div>
	);
}

// ----------------------------------------------------------------
// Props
// ----------------------------------------------------------------

interface StockChartProps {
	data: Candle[];
	chartType: ChartType;
	isLoading: boolean;
}

// ----------------------------------------------------------------
// Main chart component
// ----------------------------------------------------------------

export default function StockChart({
	data,
	chartType,
	isLoading,
}: StockChartProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const [visibleBars, setVisibleBars] = useState(30);
	const [scrollOffset, setScrollOffset] = useState(0);

	// Helper: create correct series type
	const createSeries = useCallback(
		(chart: IChartApi): ISeriesApi<SeriesType> => {
			if (chartType === 'candle') {
				return chart.addSeries(CandlestickSeries, CANDLE_OPTS);
			}
			return chart.addSeries(AreaSeries, AREA_OPTS);
		},
		[chartType],
	);

	// Initialize chart once
	useEffect(() => {
		if (!containerRef.current) return;

		const isMobile = window.innerWidth < 768;
		const chart = createChart(containerRef.current, {
			...CHART_OPTS,
			// autoSize — biblioteka sama śledzi rozmiar kontenera własnym
			// ResizeObserverem; niezawodne przy animowanej zmianie szerokości
			// panelu (np. otwarcie News Agenta), gdzie ręczny RO bywał zawodny.
			autoSize: true,
			handleScroll: isMobile ? false : true,
			handleScale: isMobile ? false : true,
		});

		const series = createSeries(chart);
		chartRef.current = chart;
		seriesRef.current = series;

		chart.subscribeCrosshairMove((param) => {
			if (!tooltipRef.current) return;
			if (!param.time || !param.point) {
				tooltipRef.current.style.display = 'none';
				return;
			}
			const price = param.seriesData.get(seriesRef.current!);
			if (!price) return;
			const value =
				'value' in price ? price.value : (price as { close: number }).close;
			tooltipRef.current.style.display = 'block';
			tooltipRef.current.innerText = `$${value.toFixed(2)}`;
			tooltipRef.current.style.left = `${param.point.x + 12}px`;
			tooltipRef.current.style.top = `${param.point.y - 30}px`;
		});

		// autoSize zmienia wymiary canvasu, ale NIE przelicza odstępu słupków —
		// przy zwężeniu prawa część danych zostaje ucięta. Po każdej zmianie
		// szerokości wymuszamy fitContent(), by całość zmieściła się w nowej
		// szerokości (np. gdy panel News Agenta odbiera miejsce wykresowi).
		const ro = new ResizeObserver(() => {
			chartRef.current?.timeScale().fitContent();
		});
		ro.observe(containerRef.current);

		return () => {
			ro.disconnect();
			chart.remove();
			chartRef.current = null;
			seriesRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // run once

	// Switch series type when chartType changes (no chart rebuild)
	useEffect(() => {
		if (!chartRef.current || !seriesRef.current) return;
		chartRef.current.removeSeries(seriesRef.current);
		const newSeries = createSeries(chartRef.current);
		seriesRef.current = newSeries;
		if (data.length > 0) {
			newSeries.setData(
				chartType === 'candle' ? toCandleData(data) : toAreaData(data),
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [chartType]); // intentionally excludes data & createSeries

	// Update data when it changes
	useEffect(() => {
		if (!seriesRef.current || data.length === 0) return;
		seriesRef.current.setData(
			chartType === 'candle' ? toCandleData(data) : toAreaData(data),
		);
		chartRef.current?.timeScale().fitContent();
		// reset scroll do prawej (najnowsze dane) przy zmianie danych
		setScrollOffset(data.length - 1);
	}, [data, chartType]);

	// Ręczna obsługa dotyku na mobile — niezawodny tooltip ceny
	useEffect(() => {
		if (!containerRef.current) return;
		const container = containerRef.current;

		const formatTime = (t: number): string => {
			const d = new Date(t * 1000);
			const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
			return `${d.getDate()} ${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
		};

		const handleTouchMove = (e: TouchEvent) => {
			if (window.innerWidth >= 768) return;
			const touch = e.touches[0];
			const rect = container.getBoundingClientRect();
			const y = touch.clientY - rect.top;
			const x = touch.clientX - rect.left;
			const price = seriesRef.current?.coordinateToPrice(y);
			const time = chartRef.current?.timeScale().coordinateToTime(x);
			if (price != null && time != null && seriesRef.current && chartRef.current) {
				chartRef.current.setCrosshairPosition(price, time, seriesRef.current);
			}
			if (price != null && tooltipRef.current) {
				const timeStr = typeof time === 'number' ? formatTime(time) : '';
				tooltipRef.current.style.display = 'block';
				tooltipRef.current.style.left = `${x}px`;
				tooltipRef.current.style.top = `${Math.max(8, y - 72)}px`;
				tooltipRef.current.innerHTML = `
					<div style="background:#111113;border:1px solid rgba(0,255,136,0.3);border-radius:10px;padding:6px 10px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.5)">
						<div style="color:#00ff88;font-size:14px;font-weight:700;font-family:monospace;letter-spacing:0.5px">$${price.toFixed(2)}</div>
						${timeStr ? `<div style="color:#71717a;font-size:10px;font-family:monospace;margin-top:2px">${timeStr}</div>` : ''}
					</div>
					<div style="width:0;height:0;margin:0 auto;border-left:5px solid transparent;border-right:5px solid transparent;border-top:5px solid rgba(0,255,136,0.3)"></div>
				`;
			}
		};

		const handleTouchEnd = () => {
			if (tooltipRef.current) tooltipRef.current.style.display = 'none';
			chartRef.current?.clearCrosshairPosition();
		};

		container.addEventListener('touchmove', handleTouchMove, { passive: true });
		container.addEventListener('touchend', handleTouchEnd);
		return () => {
			container.removeEventListener('touchmove', handleTouchMove);
			container.removeEventListener('touchend', handleTouchEnd);
		};
	}, []);
	const applyRange = (from: number, bars: number) => {
		const to = Math.min(data.length - 1, from + bars - 1);
		const clampedFrom = Math.max(0, to - bars + 1);
		chartRef.current?.timeScale().setVisibleLogicalRange({ from: clampedFrom, to });
		setScrollOffset(clampedFrom);
	};

	const handleZoomIn = () => {
		const next = Math.max(10, visibleBars - 10);
		setVisibleBars(next);
		applyRange(scrollOffset, next);
	};

	const handleZoomOut = () => {
		const next = Math.min(data.length, visibleBars + 10);
		setVisibleBars(next);
		applyRange(scrollOffset, next);
	};

	const handleScroll = (e: React.ChangeEvent<HTMLInputElement>) => {
		const from = Number(e.target.value);
		setScrollOffset(from);
		chartRef.current?.timeScale().setVisibleLogicalRange({
			from,
			to: Math.min(data.length - 1, from + visibleBars - 1),
		});
	};
	return (
		<div className='relative w-full h-full flex flex-col'>
			{/* Wykres */}
			<div className='relative flex-1 min-h-0'>
				<div ref={containerRef} className='w-full h-full' />
				{/* Price tooltip — bąbelek */}
				<div
					ref={tooltipRef}
					style={{ display: 'none', position: 'absolute', pointerEvents: 'none', transform: 'translateX(-50%)', zIndex: 10 }}
				/>
				{isLoading && (
					<div className='absolute inset-0 bg-bg-base'>
						<ChartSkeleton />
					</div>
				)}
			</div>

			{/* Kontrolki — tylko mobile */}
			<div className='md:hidden flex flex-col border-t border-border-subtle shrink-0'>
				{/* +/- zoom + hint */}
				<div className='flex items-center justify-between px-3 py-1'>
					<div className='flex items-center gap-2'>
						<button onClick={handleZoomOut} className='w-7 h-7 rounded border border-border-subtle text-zinc-400 hover:text-accent hover:border-accent font-mono text-sm'>–</button>
						<span className='font-mono text-[10px] text-zinc-600'>{visibleBars}b</span>
						<button onClick={handleZoomIn} className='w-7 h-7 rounded border border-border-subtle text-zinc-400 hover:text-accent hover:border-accent font-mono text-sm'>+</button>
					</div>
					<span className='font-mono text-[10px] text-zinc-700'>hold = price</span>
				</div>

				{/* Scrollbar — widoczny tylko gdy przybliżono */}
				{visibleBars < data.length && (
					<div className='px-3 pb-1'>
						<input
							type='range'
							min={0}
							max={Math.max(0, data.length - visibleBars)}
							value={scrollOffset}
							onChange={handleScroll}
							className='w-full h-1 accent-accent cursor-pointer'
						/>
					</div>
				)}
			</div>
		</div>
	);
}
