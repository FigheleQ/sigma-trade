import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useChartStore } from '@/store/chartStore';

export type WatchlistItem = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  addedAt: number;
};

export type WatchlistSection = {
  id: string;
  name: string;
  items: WatchlistItem[];
  isCollapsed: boolean;
  isPinned: boolean;
  color?: string;
};

type WatchlistStore = {
  sections: WatchlistSection[];
  activeTicker: string | null;

  addToSection: (sectionId: string, item: WatchlistItem) => void;
  removeFromSection: (sectionId: string, symbol: string) => void;
  addToFavorites: (item: WatchlistItem) => void;
  toggleCollapse: (sectionId: string) => void;
  setActiveTicker: (symbol: string) => void;
  createSection: (name: string, color?: string) => void;
  renameSection: (sectionId: string, name: string) => void;
  deleteSection: (sectionId: string) => void;
  reorderTickers: (sectionId: string, fromIndex: number, toIndex: number) => void;
  reorderSections: (fromIndex: number, toIndex: number) => void;
};

const now = Date.now();

// 16-color palette shared with ListPanel color picker
export const COLOR_PALETTE = [
  '#1D9E75', // teal
  '#BA7517', // amber
  '#185FA5', // steel blue
  '#7C3AED', // violet
  '#DB2777', // pink
  '#DC2626', // red
  '#D97706', // orange
  '#059669', // emerald
  '#0891B2', // cyan
  '#4F46E5', // indigo
  '#9333EA', // purple
  '#65A30D', // lime
  '#C2410C', // burnt orange
  '#0D9488', // teal-600
  '#BE185D', // rose
  '#1D4ED8', // blue
];

const DEFAULT_SECTIONS: WatchlistSection[] = [
  {
    id: 'main',
    name: 'Główna',
    isPinned: true,
    isCollapsed: false,
    color: '#1D9E75',
    items: [
      { symbol: 'AAPL',  name: 'Apple Inc.',       exchange: 'NASDAQ', type: 'Common Stock', addedAt: now },
      { symbol: 'MSFT',  name: 'Microsoft Corp.',   exchange: 'NASDAQ', type: 'Common Stock', addedAt: now },
      { symbol: 'GOOGL', name: 'Alphabet Inc.',     exchange: 'NASDAQ', type: 'Common Stock', addedAt: now },
      { symbol: 'TSLA',  name: 'Tesla Inc.',        exchange: 'NASDAQ', type: 'Common Stock', addedAt: now },
      { symbol: 'NVDA',  name: 'NVIDIA Corp.',      exchange: 'NASDAQ', type: 'Common Stock', addedAt: now },
    ],
  },
  {
    id: 'favorites',
    name: 'Ulubione',
    isPinned: true,
    isCollapsed: false,
    color: '#BA7517',
    items: [],
  },
  {
    id: 'tracked',
    name: 'Śledzone',
    isPinned: false,
    isCollapsed: false,
    color: '#185FA5',
    items: [],
  },
];

export const useWatchlistStore = create<WatchlistStore>()(
  persist(
    (set) => ({
      sections: DEFAULT_SECTIONS,
      activeTicker: 'AAPL',

      addToSection: (sectionId, item) =>
        set((state) => ({
          sections: state.sections.map((section) =>
            section.id === sectionId && !section.items.some((i) => i.symbol === item.symbol)
              ? { ...section, items: [...section.items, { ...item, addedAt: Date.now() }] }
              : section
          ),
        })),

      removeFromSection: (sectionId, symbol) =>
        set((state) => ({
          sections: state.sections.map((section) =>
            section.id === sectionId
              ? { ...section, items: section.items.filter((i) => i.symbol !== symbol) }
              : section
          ),
        })),

      addToFavorites: (item) =>
        set((state) => {
          const favorites = state.sections.find((s) => s.id === 'favorites');
          if (favorites?.items.some((i) => i.symbol === item.symbol)) return state;
          return {
            sections: state.sections.map((section) =>
              section.id === 'favorites'
                ? { ...section, items: [...section.items, { ...item, addedAt: Date.now() }] }
                : section
            ),
          };
        }),

      toggleCollapse: (sectionId) =>
        set((state) => ({
          sections: state.sections.map((section) =>
            section.id === sectionId
              ? { ...section, isCollapsed: !section.isCollapsed }
              : section
          ),
        })),

      setActiveTicker: (symbol) => {
        set({ activeTicker: symbol });
        useChartStore.getState().setActiveTicker(symbol);
      },

      createSection: (name, color) =>
        set((state) => {
          const customCount = state.sections.filter(
            (s) => !['main', 'favorites', 'tracked'].includes(s.id),
          ).length;
          const assignedColor = color ?? COLOR_PALETTE[3 + (customCount % (COLOR_PALETTE.length - 3))];
          return {
            sections: [
              ...state.sections,
              { id: `section_${Date.now()}`, name, isPinned: false, isCollapsed: false, color: assignedColor, items: [] },
            ],
          };
        }),

      renameSection: (sectionId, name) =>
        set((state) => ({
          sections: state.sections.map((s) => s.id === sectionId ? { ...s, name } : s),
        })),

      deleteSection: (sectionId) =>
        set((state) => ({
          sections: state.sections.filter((s) => s.id !== sectionId),
        })),

      reorderTickers: (sectionId, fromIndex, toIndex) =>
        set((state) => ({
          sections: state.sections.map((section) => {
            if (section.id !== sectionId) return section;
            const items = [...section.items];
            const [moved] = items.splice(fromIndex, 1);
            items.splice(toIndex, 0, moved);
            return { ...section, items };
          }),
        })),

      reorderSections: (fromIndex, toIndex) =>
        set((state) => {
          const sections = [...state.sections];
          const [moved] = sections.splice(fromIndex, 1);
          sections.splice(toIndex, 0, moved);
          return { sections };
        }),
    }),
    { name: 'atomic_puff_watchlist' }
  )
);
