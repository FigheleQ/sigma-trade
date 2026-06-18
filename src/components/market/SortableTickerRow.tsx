'use client';

import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Star, MoreVertical, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WatchlistItem } from '@/store/watchlistStore';
import type { QuoteEntry } from '@/hooks/useWatchlistQuotes';

interface Props {
  item: WatchlistItem;
  sectionId: string;
  isActive: boolean;
  inFavorites: boolean;
  quote: QuoteEntry | undefined;
  onSelect: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onMore: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onRemove: (e: React.MouseEvent) => void;
  mobileMode?: boolean;
}

export default function SortableTickerRow({
  item,
  sectionId,
  isActive,
  inFavorites,
  quote,
  onSelect,
  onToggleFavorite,
  onMore,
  onRemove,
  mobileMode = false,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.symbol,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const positive = (quote?.changePercent ?? 0) >= 0;
  const isFavoritesSection = sectionId === 'favorites';

  // Flash row background when price changes
  const prevPriceRef = useRef<number | undefined>(undefined);
  const [flashDir, setFlashDir] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const price = quote?.price;
    if (price === undefined) return;
    const prev = prevPriceRef.current;
    prevPriceRef.current = price;
    if (prev !== undefined && prev !== price) {
      setFlashDir(price > prev ? 'up' : 'down');
      const t = setTimeout(() => setFlashDir(null), 900);
      return () => clearTimeout(t);
    }
  }, [quote?.price]);

  // Desktop button area: [star][more][minus]
  // Each button ≈ p-1 (8px) + icon-11px = 19px.
  // Star sits at translateX(+38px) by default so it visually lands on
  // the far-right edge (over the two invisible buttons behind it).
  // On group-hover the star springs back to translateX(0) via the
  // cubic-bezier spring defined in .star-bounce (globals.css).
  const starDesktop = !isFavoritesSection && !mobileMode;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-center border-b border-border-subtle transition-colors duration-150',
        isActive
          ? 'border-l-2 border-l-accent bg-accent/5'
          : 'border-l-2 border-l-transparent hover:bg-zinc-900',
        isDragging && 'opacity-40 bg-zinc-900',
      )}
    >
      {/* Flash overlay */}
      {flashDir && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none rounded-[1px]',
            flashDir === 'up' ? 'quote-flash-up' : 'quote-flash-down',
          )}
        />
      )}

      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        tabIndex={-1}
        className={cn(
          'pl-1.5 pr-0 py-3 text-zinc-700 hover:text-zinc-500 cursor-grab active:cursor-grabbing transition-opacity shrink-0 touch-none',
          mobileMode ? 'opacity-60' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <GripVertical size={12} />
      </button>

      {/* Main clickable area */}
      <button onClick={onSelect} className="flex-1 text-left px-1.5 py-3 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span
            className={cn(
              'font-mono text-[13px] font-bold tracking-wide',
              isActive ? 'text-accent' : 'text-zinc-300',
            )}
          >
            {item.symbol}
          </span>
          {quote && (
            <span
              className={cn(
                'font-mono text-[10px] shrink-0 tabular-nums transition-opacity group-hover:opacity-0',
                positive ? 'text-accent' : 'text-red-400',
              )}
            >
              {positive ? '+' : ''}
              {quote.changePercent.toFixed(2)}%
            </span>
          )}
        </div>
        <span className="block font-mono text-[10px] text-zinc-600 truncate mt-0.5">
          {item.name}
        </span>
      </button>

      {/* ── Button cluster ── */}
      <div className="flex items-center pr-1 shrink-0">

        {/* Star
            Desktop: always rendered (not in favorites section), sits at +38px
            so it appears at the far-right edge when the other two buttons are
            invisible. Springs to translateX(0) on group-hover.
            Mobile:  shown normally, all buttons visible. */}
        {!isFavoritesSection && (
          <button
            onClick={onToggleFavorite}
            title={inFavorites ? 'Usuń z Ulubionych' : 'Dodaj do Ulubionych'}
            className={cn(
              'p-1 rounded',
              inFavorites
                ? 'text-yellow-400 hover:text-yellow-300'
                : 'text-zinc-700 hover:text-zinc-400',
              starDesktop && 'translate-x-[38px] group-hover:translate-x-0 star-bounce',
            )}
          >
            <Star size={mobileMode ? 14 : 11} fill={inFavorites ? 'currentColor' : 'none'} />
          </button>
        )}

        {/* More — desktop: invisible + no pointer-events until hover, with a
            short delay so the star is already mid-bounce when they appear. */}
        <button
          onClick={onMore}
          className={cn(
            'p-1 rounded text-zinc-600 hover:text-zinc-400 transition-colors',
            !mobileMode && [
              'opacity-0 pointer-events-none',
              'group-hover:opacity-100 group-hover:pointer-events-auto',
              'transition-opacity duration-150 group-hover:delay-100',
            ],
          )}
          title="Dodaj do listy"
        >
          <MoreVertical size={mobileMode ? 14 : 11} />
        </button>

        {/* Minus */}
        <button
          onClick={onRemove}
          className={cn(
            'p-1 rounded text-zinc-700 hover:text-red-400 transition-colors',
            !mobileMode && [
              'opacity-0 pointer-events-none',
              'group-hover:opacity-100 group-hover:pointer-events-auto',
              'transition-opacity duration-150 group-hover:delay-100',
            ],
          )}
          title="Usuń z listy"
        >
          <Minus size={mobileMode ? 14 : 11} />
        </button>
      </div>
    </div>
  );
}
