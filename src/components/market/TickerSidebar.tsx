'use client';

import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Search, ChevronDown, ChevronRight,
  GripVertical, Pencil, Trash2, Check,
  ChevronsLeft, ChevronsRight, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useWatchlistStore,
  type WatchlistItem,
  type WatchlistSection,
} from '@/store/watchlistStore';
import { useWatchlistQuotes } from '@/hooks/useWatchlistQuotes';
import SortableTickerRow from './SortableTickerRow';
import ListPanel from './ListPanel';
import SearchModal from './SearchModal';

const BUILT_IN = ['main', 'favorites', 'tracked'];

// ── Sortable section wrapper ────────────────────────────────────────────────
function SortableSectionItem({
  section,
  children,
}: {
  section: WatchlistSection;
  children: (
    gripListeners: ReturnType<typeof useSortable>['listeners'],
    gripAttributes: ReturnType<typeof useSortable>['attributes'],
    isDragging: boolean,
  ) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : ''}
    >
      {children(listeners, attributes, isDragging)}
    </div>
  );
}

function useMiniMode(): [boolean, (v: boolean) => void] {
  const [isMini, setMiniRaw] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_mini') === '1';
  });
  const setMini = (v: boolean) => {
    setMiniRaw(v);
    localStorage.setItem('sidebar_mini', v ? '1' : '0');
  };
  return [isMini, setMini];
}

// ── Main component ──────────────────────────────────────────────────────────
export default function TickerSidebar() {
  const {
    sections,
    activeTicker,
    addToFavorites,
    removeFromSection,
    toggleCollapse,
    setActiveTicker,
    renameSection,
    deleteSection,
    reorderTickers,
    reorderSections,
  } = useWatchlistStore();

  const [isMini, setIsMini] = useMiniMode();
  const [listPanelFor, setListPanelFor] = useState<{
    item: WatchlistItem;
    sectionId: string;
    anchor: DOMRect;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // % change — only for visible tickers
  const visibleSymbols = sections
    .filter((s) => !s.isCollapsed)
    .flatMap((s) => s.items.map((i) => i.symbol));

  // Fast polling for the section containing the active ticker
  const activeSection = sections.find(
    (s) => !s.isCollapsed && s.items.some((i) => i.symbol === activeTicker),
  );
  const fastSymbols = activeSection?.items.map((i) => i.symbol) ?? [];

  const quotes = useWatchlistQuotes(visibleSymbols, fastSymbols);

  const favorites = sections.find((s) => s.id === 'favorites');
  const isInFavorites = (symbol: string) =>
    favorites?.items.some((i) => i.symbol === symbol) ?? false;

  // DnD sensors — 8px activation distance prevents accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = sections.findIndex((s) => s.id === active.id);
    const to = sections.findIndex((s) => s.id === over.id);
    if (from !== -1 && to !== -1) reorderSections(from, to);
  };

  const makeTickerDragEnd = (sectionId: string) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;
    const from = section.items.findIndex((i) => i.symbol === active.id);
    const to = section.items.findIndex((i) => i.symbol === over.id);
    if (from !== -1 && to !== -1) reorderTickers(sectionId, from, to);
  };

  const startEdit = (e: React.MouseEvent, section: WatchlistSection) => {
    e.stopPropagation();
    setEditingSectionId(section.id);
    setEditingName(section.name);
  };

  const saveEdit = () => {
    if (editingSectionId && editingName.trim()) {
      renameSection(editingSectionId, editingName.trim());
    }
    setEditingSectionId(null);
  };

  // ── Mini mode ──────────────────────────────────────────────────────────────
  if (isMini) {
    return (
      <div className="w-[52px] shrink-0 border-r border-border-subtle flex flex-col h-full overflow-hidden transition-[width] duration-200">
        {/* Mini header — just expand button */}
        <div className="px-1 py-2 border-b border-border-subtle shrink-0 flex items-center justify-center">
          <button
            onClick={() => setIsMini(false)}
            className="p-0.5 text-zinc-600 hover:text-accent transition-colors"
            title="Rozwiń sidebar"
          >
            <ChevronsRight size={13} />
          </button>
        </div>

        {/* Compact ticker list */}
        <div className="flex flex-col flex-1 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.id}>
              {/* Color dot as section separator */}
              <div className="flex justify-center py-1.5">
                {section.color
                  ? <span className="w-2 h-2 rounded-full" style={{ background: section.color }} />
                  : <span className="w-full h-px bg-border-subtle mx-2" />
                }
              </div>
              {!section.isCollapsed && section.items.map((item) => (
                <button
                  key={item.symbol}
                  onClick={() => setActiveTicker(item.symbol)}
                  title={`${item.symbol} — ${item.name}`}
                  className={cn(
                    'w-full flex items-center justify-center py-2.5 border-b border-border-subtle border-l-2 transition-colors',
                    item.symbol === activeTicker
                      ? 'border-l-accent bg-accent/5 text-accent'
                      : 'border-l-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
                  )}
                >
                  <span className="font-mono text-[9px] font-bold tracking-wide">{item.symbol}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Full mode ──────────────────────────────────────────────────────────────
  return (
    <div className="w-[185px] shrink-0 border-r border-border-subtle flex flex-col h-full overflow-hidden transition-[width] duration-200">
      {/* Top header */}
      <div className="px-3 py-2 border-b border-border-subtle shrink-0 flex items-center justify-between">
        <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider">
          Watchlist
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMini(true)}
            className="p-0.5 text-zinc-600 hover:text-accent transition-colors"
            title="Tryb mini"
          >
            <ChevronsLeft size={13} />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className="p-0.5 text-zinc-600 hover:text-accent transition-colors"
            title="Wyszukaj instrument"
          >
            <Search size={13} />
          </button>
        </div>
      </div>

      {/* Section list with outer DnD (section reordering) */}
      <div className="flex flex-col flex-1 overflow-y-auto">
        <DndContext
          id="sidebar-sections"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleSectionDragEnd}
        >
          <SortableContext
            items={sections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            {sections.map((section) => (
              <SortableSectionItem key={section.id} section={section}>
                {(gripListeners, gripAttributes) => (
                  <div>
                    {/* ── Section header ── */}
                    {editingSectionId === section.id ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveEdit(); }}
                        className="flex items-center gap-1 px-2 py-2"
                      >
                        {section.color && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: section.color }}
                          />
                        )}
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => { if (e.key === 'Escape') setEditingSectionId(null); }}
                          className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 focus:border-accent rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-200 focus:outline-none transition-colors"
                        />
                        <button type="submit" className="text-zinc-500 hover:text-accent shrink-0">
                          <Check size={11} />
                        </button>
                      </form>
                    ) : (
                      <div className="group/hdr relative flex items-center">
                        {/* Section drag handle */}
                        <button
                          {...gripListeners}
                          {...gripAttributes}
                          tabIndex={-1}
                          className="pl-1 pr-0 py-2.5 text-zinc-700 hover:text-zinc-500 cursor-grab active:cursor-grabbing opacity-0 group-hover/hdr:opacity-100 transition-opacity shrink-0 touch-none"
                        >
                          <GripVertical size={12} />
                        </button>

                        {/* Collapse toggle */}
                        <button
                          onClick={() => toggleCollapse(section.id)}
                          className="flex-1 flex items-center gap-2 pr-2 py-2.5 min-w-0"
                        >
                          {section.isCollapsed
                            ? <ChevronRight size={12} className="text-zinc-500 shrink-0" />
                            : <ChevronDown size={12} className="text-zinc-500 shrink-0" />
                          }
                          {section.color && (
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: section.color }}
                            />
                          )}
                          <span
                            className={cn(
                              'font-mono text-[11px] uppercase tracking-wider truncate font-medium',
                              section.id === 'favorites' ? 'text-white' : 'text-zinc-400',
                            )}
                          >
                            {section.id === 'favorites' ? 'Ulubione' : section.name}
                          </span>
                          {section.id === 'favorites' && (
                            <Star size={10} className="shrink-0 text-yellow-400 fill-yellow-400" />
                          )}
                          <span className="font-mono text-[10px] text-zinc-600 ml-auto shrink-0">
                            {section.items.length}
                          </span>
                        </button>

                        {/* Rename / delete — hidden for favorites, appear on hover for others */}
                        {section.id !== 'favorites' && (
                          <div className="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover/hdr:opacity-100 transition-opacity bg-zinc-900/80 rounded px-0.5">
                            <button
                              onClick={(e) => startEdit(e, section)}
                              className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                              title="Zmień nazwę"
                            >
                              <Pencil size={10} />
                            </button>
                            {!BUILT_IN.includes(section.id) && (
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteSection(section.id); }}
                                className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                                title="Usuń sekcję"
                              >
                                <Trash2 size={10} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Ticker list with inner DnD ── */}
                    {!section.isCollapsed && (
                      <DndContext
                        id={`sidebar-tickers-${section.id}`}
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={makeTickerDragEnd(section.id)}
                      >
                        <SortableContext
                          items={section.items.map((i) => i.symbol)}
                          strategy={verticalListSortingStrategy}
                        >
                          {section.items.map((item) => (
                            <SortableTickerRow
                              key={item.symbol}
                              item={item}
                              sectionId={section.id}
                              isActive={item.symbol === activeTicker}
                              inFavorites={isInFavorites(item.symbol)}
                              quote={quotes[item.symbol]}
                              onSelect={() => setActiveTicker(item.symbol)}
                              onToggleFavorite={(e) => {
                                e.stopPropagation();
                                if (isInFavorites(item.symbol)) removeFromSection('favorites', item.symbol);
                                else addToFavorites(item);
                              }}
                              onMore={(e) => {
                                e.stopPropagation();
                                setListPanelFor({
                                  item,
                                  sectionId: section.id,
                                  anchor: e.currentTarget.getBoundingClientRect(),
                                });
                              }}
                              onRemove={(e) => {
                                e.stopPropagation();
                                removeFromSection(section.id, item.symbol);
                              }}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                )}
              </SortableSectionItem>
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {listPanelFor && (
        <ListPanel
          item={listPanelFor.item}
          anchor={listPanelFor.anchor}
          onClose={() => setListPanelFor(null)}
        />
      )}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
