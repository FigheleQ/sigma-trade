'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWatchlistStore, type WatchlistItem, COLOR_PALETTE } from '@/store/watchlistStore';

interface ListPanelProps {
  item: WatchlistItem;
  anchor: DOMRect;
  onClose: () => void;
}

const SWIPE_CLOSE_THRESHOLD = 80; // px

export default function ListPanel({ item, anchor, onClose }: ListPanelProps) {
  const { sections, addToSection, createSection } = useWatchlistStore();
  const [newListName, setNewListName] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[3]);

  // Mount / close animation
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose(), 300);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleClose]);

  // ── Swipe-to-close ──────────────────────────────────────────────
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta < 0) return; // block upward swipe
    touchDeltaY.current = delta;
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${delta}px)`;
    sheet.style.opacity = `${Math.max(0.4, 1 - delta / 250)}`;
  };

  const onTouchEnd = () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = '';
    sheet.style.transform = '';
    sheet.style.opacity = '';
    if (touchDeltaY.current > SWIPE_CLOSE_THRESHOLD) {
      handleClose();
    }
  };
  // ────────────────────────────────────────────────────────────────

  const isInSection = (sectionId: string) =>
    sections.find((s) => s.id === sectionId)?.items.some((i) => i.symbol === item.symbol) ?? false;

  const handleCreate = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    createSection(name, selectedColor);
    setNewListName('');
    setShowInput(false);
  };

  // Desktop popover position
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const popoverH = showInput ? 360 : 280;
  const top = Math.min(anchor.top, viewportH - popoverH - 16);
  const left = anchor.right + 8;

  const colorPicker = (
    <div className="pt-2">
      <div className="grid grid-cols-8 gap-1">
        {COLOR_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setSelectedColor(c)}
            className={cn(
              'w-5 h-5 rounded-full transition-transform hover:scale-110 shrink-0',
              selectedColor === c && 'ring-2 ring-white ring-offset-1 ring-offset-zinc-900 scale-110',
            )}
            style={{ background: c }}
            title={c}
          />
        ))}
      </div>
    </div>
  );

  // Shared: section list + create new — used in both desktop and mobile
  const panelBody = (
    <>
      <div className="py-1 max-h-48 overflow-y-auto">
        {sections.map((section) => {
          const inSection = isInSection(section.id);
          return (
            <div
              key={section.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 transition-colors"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: section.color ?? '#555' }}
              />
              <span className="font-mono text-[11px] text-zinc-300 flex-1 truncate">
                {section.name}
              </span>
              <span className="font-mono text-[10px] text-zinc-600 shrink-0 w-5 text-right">
                {section.items.length}
              </span>
              <button
                onClick={() => !inSection && addToSection(section.id, item)}
                disabled={inSection}
                title={inSection ? 'Już na liście' : `Dodaj do ${section.name}`}
                className={cn(
                  'ml-1 w-5 h-5 flex items-center justify-center rounded transition-colors shrink-0',
                  inSection
                    ? 'text-accent cursor-default'
                    : 'text-zinc-500 hover:text-accent hover:bg-zinc-700',
                )}
              >
                {inSection ? <Check size={11} /> : <Plus size={11} />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-zinc-700/60 mx-3" />

      <div className="py-2 px-3">
        {showInput ? (
          <form onSubmit={handleCreate} className="space-y-2">
            <div className="flex gap-1.5">
              <span
                className="w-3 h-3 rounded-full shrink-0 self-center"
                style={{ background: selectedColor }}
              />
              <input
                autoFocus
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setShowInput(false)}
                placeholder="Nazwa listy…"
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 font-mono text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-accent transition-colors min-w-0"
              />
              <button
                type="submit"
                disabled={!newListName.trim()}
                className="px-2 py-1 bg-accent/20 text-accent rounded font-mono text-[10px] hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                OK
              </button>
            </div>
            {colorPicker}
          </form>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 font-mono text-[11px] transition-colors"
          >
            <Plus size={12} />
            utwórz nową listę
          </button>
        )}
      </div>
    </>
  );

  const isOpen = mounted && !closing;

  return (
    <>
      {/*
        Backdrop z-[55] — powyżej panelu drawera (z-50), żeby przechwycić
        klik "poza ListPanel" bez zamykania drawera
      */}
      <div
        className={cn(
          'fixed inset-0 z-[55] md:bg-transparent transition-opacity duration-300',
          isOpen ? 'bg-black/50 opacity-100' : 'bg-black/50 opacity-0',
        )}
        onClick={handleClose}
      />

      {/* Desktop: popover — bez animacji */}
      <div
        className="hidden md:block fixed z-[60] w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
        style={{ top, left }}
      >
        {/* Desktop header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-700/60">
          <span className="font-mono text-[11px] text-zinc-300 font-medium truncate pr-2">
            {item.symbol} — dodaj do listy
          </span>
          <button onClick={handleClose} className="text-zinc-500 hover:text-accent transition-colors shrink-0">
            <X size={14} />
          </button>
        </div>
        {panelBody}
      </div>

      {/* Mobile: bottom sheet z-[60] — slide-up + swipe-to-close */}
      <div
        ref={sheetRef}
        className={cn(
          'md:hidden fixed inset-x-0 bottom-0 z-[60]',
          'bg-zinc-900 border-t border-zinc-700 rounded-t-2xl shadow-2xl',
          'transition-transform duration-300 will-change-transform',
          isOpen ? 'translate-y-0 ease-out' : 'translate-y-full ease-in',
        )}
      >
        {/* Swipe zone: drag handle + header — touch handlers tu, nie na liście */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="touch-none select-none cursor-grab active:cursor-grabbing"
        >
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-12 h-1 bg-zinc-600 rounded-full" />
          </div>
          <div className="flex items-center justify-between px-3 pb-2.5 border-b border-zinc-700/60">
            <span className="font-mono text-[11px] text-zinc-300 font-medium truncate pr-2">
              {item.symbol} — dodaj do listy
            </span>
            <button onClick={handleClose} className="text-zinc-500 hover:text-accent transition-colors shrink-0">
              <X size={14} />
            </button>
          </div>
        </div>

        {panelBody}
        <div className="pb-2" />
      </div>
    </>
  );
}
