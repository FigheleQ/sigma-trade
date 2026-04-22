'use client';

import { useState, useEffect } from 'react';
import { Search, X, Star, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWatchlistStore, type WatchlistItem } from '@/store/watchlistStore';
import ListPanel from './ListPanel';

type SearchResult = {
  symbol: string;
  instrument_name: string;
  exchange: string;
  mic_code: string;
  instrument_type: string;
  country: string;
  currency: string;
};

type SearchStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error';

interface SearchModalProps {
  onClose: () => void;
}

export default function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [listPanelFor, setListPanelFor] = useState<{
    item: WatchlistItem;
    anchor: DOMRect;
  } | null>(null);

  const { sections, addToFavorites, removeFromSection, addToSection, setActiveTicker } =
    useWatchlistStore();

  const favorites = sections.find((s) => s.id === 'favorites');
  const isInFavorites = (symbol: string) =>
    favorites?.items.some((i) => i.symbol === symbol) ?? false;

  // ESC closes modal (if ListPanel is open, ESC closes that first)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (listPanelFor) setListPanelFor(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, listPanelFor]);

  // Debounced search — 600ms, min 2 chars
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }

    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbol_search?symbol=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: SearchResult[] = data.data ?? [];
        setResults(items);
        setStatus(items.length > 0 ? 'ok' : 'empty');
        setHighlightedIdx(0);
      } catch {
        setResults([]);
        setStatus('error');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [query]);

  const toItem = (r: SearchResult): WatchlistItem => ({
    symbol: r.symbol,
    name: r.instrument_name,
    exchange: r.exchange,
    type: r.instrument_type,
    addedAt: Date.now(),
  });

  const handleSelect = (r: SearchResult) => {
    addToSection('main', toItem(r));
    setActiveTicker(r.symbol);
    onClose();
  };

  const handleMoreClick = (e: React.MouseEvent<HTMLButtonElement>, r: SearchResult) => {
    e.stopPropagation();
    setListPanelFor({ item: toItem(r), anchor: e.currentTarget.getBoundingClientRect() });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[highlightedIdx]) {
      handleSelect(results[highlightedIdx]);
    }
  };

  // Shared result rows — highlight only relevant on desktop (keyboard nav)
  const renderResults = (enableHighlight = true) =>
    results.map((r, idx) => {
      const inFav = isInFavorites(r.symbol);
      return (
        <div
          key={`${r.symbol}:${r.mic_code}`}
          onClick={() => handleSelect(r)}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors border-b border-zinc-800/60',
            enableHighlight && idx === highlightedIdx
              ? 'bg-zinc-800'
              : 'hover:bg-zinc-800/60',
          )}
        >
          <span className="font-mono text-xs font-bold text-zinc-200 w-14 shrink-0">
            {r.symbol}
          </span>
          <span className="font-mono text-[11px] text-zinc-400 flex-1 truncate">
            {r.instrument_name}
          </span>
          <span className="font-mono text-[10px] text-zinc-600 shrink-0 hidden sm:block w-16 text-right">
            {r.exchange}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (inFav) removeFromSection('favorites', r.symbol);
                else addToFavorites(toItem(r));
              }}
              className={cn(
                'p-1.5 rounded transition-colors',
                inFav
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-zinc-600 hover:text-zinc-400',
              )}
              title={inFav ? 'Usuń z Ulubionych' : 'Dodaj do Ulubionych'}
            >
              <Star size={13} fill={inFav ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={(e) => handleMoreClick(e, r)}
              className="p-1.5 rounded text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Dodaj do listy"
            >
              <MoreVertical size={13} />
            </button>
          </div>
        </div>
      );
    });

  const skeletons = Array.from({ length: 5 }).map((_, i) => (
    <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60">
      <div className="w-12 h-3 bg-zinc-800 rounded animate-pulse" />
      <div className="h-3 bg-zinc-800 rounded animate-pulse flex-1" />
      <div className="w-14 h-3 bg-zinc-800 rounded animate-pulse hidden sm:block" />
    </div>
  ));

  const renderStatus = (enableHighlight = true) => {
    if (status === 'idle')
      return (
        <p className="px-4 py-10 text-center font-mono text-xs text-zinc-600">
          wpisz nazwę spółki lub ticker
        </p>
      );
    if (status === 'loading') return <div>{skeletons}</div>;
    if (status === 'ok') return <div>{renderResults(enableHighlight)}</div>;
    if (status === 'empty')
      return (
        <p className="px-4 py-10 text-center font-mono text-xs text-zinc-500">
          Brak wyników dla <span className="text-zinc-300">"{query}"</span>
        </p>
      );
    return (
      <p className="px-4 py-10 text-center font-mono text-xs text-red-400">
        Nie udało się pobrać wyników. Spróbuj ponownie.
      </p>
    );
  };

  return (
    <>
      {/* ─── Desktop modal ─── */}
      <div
        className="hidden md:flex fixed inset-0 z-50 items-start justify-center pt-[15vh]"
        style={{ background: 'rgba(0,0,0,0.6)', pointerEvents: 'all' }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-xl bg-zinc-950 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-3 border-b-2 border-zinc-800 focus-within:border-accent transition-colors">
            <Search size={15} className="text-zinc-500 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Szukaj spółki lub tickera…"
              className="flex-1 bg-transparent font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto">{renderStatus(true)}</div>

          {/* Footer */}
          <div className="px-3 py-1.5 border-t border-zinc-800 flex gap-4">
            <span className="font-mono text-[9px] text-zinc-700">ESC aby zamknąć</span>
            <span className="font-mono text-[9px] text-zinc-700">Enter aby otworzyć wykres</span>
            <span className="font-mono text-[9px] text-zinc-700">600ms debounce</span>
          </div>
        </div>
      </div>

      {/* ─── Mobile fullscreen ─── */}
      <div className="md:hidden fixed inset-0 z-50 bg-bg-base flex flex-col">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-3 py-3 border-b-2 border-zinc-800 focus-within:border-accent transition-colors shrink-0">
          <Search size={15} className="text-zinc-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Szukaj spółki lub tickera…"
            className="flex-1 bg-transparent font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="text-zinc-500 hover:text-zinc-300 p-1 transition-colors"
            >
              <X size={15} />
            </button>
          ) : null}
          <button
            onClick={onClose}
            className="font-mono text-xs text-zinc-400 hover:text-accent px-2 py-1 transition-colors shrink-0"
          >
            Anuluj
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">{renderStatus(false)}</div>
      </div>

      {/* ListPanel from search results */}
      {listPanelFor && (
        <ListPanel
          item={listPanelFor.item}
          anchor={listPanelFor.anchor}
          onClose={() => setListPanelFor(null)}
        />
      )}
    </>
  );
}
