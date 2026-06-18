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
  Menu, X, Search, ChevronDown, ChevronRight,
  GripVertical, Pencil, Trash2, Check, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useWatchlistStore,
  type WatchlistItem,
  type WatchlistSection,
} from '@/store/watchlistStore';
import { useWatchlistQuotes } from '@/hooks/useWatchlistQuotes';
import SortableTickerRow from './SortableTickerRow';
import SearchModal from './SearchModal';
import ListPanel from './ListPanel';

const BUILT_IN = ['main', 'favorites', 'tracked'];

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

export default function MobileTickerDrawer() {
  const {
    sections,
    activeTicker,
    setActiveTicker,
    toggleCollapse,
    addToFavorites,
    removeFromSection,
    renameSection,
    deleteSection,
    reorderTickers,
    reorderSections,
  } = useWatchlistStore();

  const [isOpen, setIsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [listPanelFor, setListPanelFor] = useState<{
    item: WatchlistItem;
    anchor: DOMRect;
  } | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const visibleSymbols = sections
    .filter((s) => !s.isCollapsed)
    .flatMap((s) => s.items.map((i) => i.symbol));
  const quotes = useWatchlistQuotes(visibleSymbols);

  const favorites = sections.find((s) => s.id === 'favorites');
  const isInFavorites = (symbol: string) =>
    favorites?.items.some((i) => i.symbol === symbol) ?? false;

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

  const handleSelect = (symbol: string) => {
    setActiveTicker(symbol);
    setIsOpen(false);
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="p-1 text-zinc-400 hover:text-accent">
        <Menu size={20} />
      </button>

      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/60 z-40 md:hidden transition-opacity duration-300',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer panel */}
      <div
        className={cn(
          'fixed top-0 left-0 h-full w-[280px] bg-bg-panel border-r border-border-subtle z-50 md:hidden',
          'transition-transform duration-300 ease-in-out flex flex-col',
          isOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider">
            Watchlist
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="p-1.5 text-zinc-500 hover:text-accent transition-colors"
              title="Wyszukaj instrument"
            >
              <Search size={16} />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-zinc-500 hover:text-accent transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Sections with outer DnD */}
        <div className="flex flex-col overflow-y-auto flex-1 pb-12">
          <DndContext
            id="mobile-sections"
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
                      {/* Section header */}
                      {editingSectionId === section.id ? (
                        <form
                          onSubmit={(e) => { e.preventDefault(); saveEdit(); }}
                          className="flex items-center gap-2 px-3 py-2.5"
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
                            className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 focus:border-accent rounded px-2 py-1 font-mono text-[11px] text-zinc-200 focus:outline-none transition-colors"
                          />
                          <button type="submit" className="text-zinc-500 hover:text-accent shrink-0 p-1">
                            <Check size={13} />
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center">
                          {/* Section drag handle — always visible on mobile */}
                          <button
                            {...gripListeners}
                            {...gripAttributes}
                            tabIndex={-1}
                            className="pl-2 pr-1 py-3 text-zinc-600 cursor-grab active:cursor-grabbing shrink-0 touch-none"
                          >
                            <GripVertical size={14} />
                          </button>

                          {/* Collapse toggle */}
                          <button
                            onClick={() => toggleCollapse(section.id)}
                            className="flex-1 flex items-center gap-2 py-3 min-w-0"
                          >
                            {section.isCollapsed
                              ? <ChevronRight size={13} className="text-zinc-500 shrink-0" />
                              : <ChevronDown size={13} className="text-zinc-500 shrink-0" />
                            }
                            {section.color && (
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ background: section.color }}
                              />
                            )}
                            <span
                              className={cn(
                                'font-mono text-[12px] uppercase tracking-wider font-medium truncate',
                                section.id === 'favorites' ? 'text-white' : 'text-zinc-400',
                              )}
                            >
                              {section.id === 'favorites' ? 'Ulubione' : section.name}
                            </span>
                            {section.id === 'favorites' && (
                              <Star size={11} className="shrink-0 text-yellow-400 fill-yellow-400" />
                            )}
                            <span className="font-mono text-[10px] text-zinc-600 ml-auto shrink-0">
                              {section.items.length}
                            </span>
                          </button>

                          {/* Rename + delete — hidden for favorites */}
                          {section.id !== 'favorites' && (
                            <div className="flex items-center gap-0.5 pr-2 shrink-0">
                              <button
                                onClick={(e) => startEdit(e, section)}
                                className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                                title="Zmień nazwę"
                              >
                                <Pencil size={12} />
                              </button>
                              {!BUILT_IN.includes(section.id) && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteSection(section.id); }}
                                  className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                                  title="Usuń sekcję"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Ticker list with inner DnD */}
                      {!section.isCollapsed && (
                        <DndContext
                          id={`mobile-tickers-${section.id}`}
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
                                mobileMode
                                onSelect={() => handleSelect(item.symbol)}
                                onToggleFavorite={(e) => {
                                  e.stopPropagation();
                                  if (isInFavorites(item.symbol)) removeFromSection('favorites', item.symbol);
                                  else addToFavorites(item);
                                }}
                                onMore={(e) => {
                                  e.stopPropagation();
                                  setListPanelFor({
                                    item,
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
      </div>

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
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
