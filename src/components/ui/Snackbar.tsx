'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SnackbarMessage {
  id: number;
  type: 'ok' | 'err';
  text: string;
}

interface SnackbarProps {
  message: SnackbarMessage | null;
}

export default function Snackbar({ message }: SnackbarProps) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<SnackbarMessage | null>(null);

  useEffect(() => {
    if (!message) return;
    setCurrent(message);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, [message]);

  if (!current) return null;

  return (
    <div
      data-cy="snackbar"
      data-visible={visible}
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none',
        'transition-all duration-300',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
      )}
    >
      <div
        className={cn(
          'px-4 py-2.5 rounded-lg font-mono text-[11px] shadow-xl border backdrop-blur-sm whitespace-nowrap',
          current.type === 'ok'
            ? 'bg-zinc-900/95 border-accent/30 text-accent'
            : 'bg-zinc-900/95 border-red-500/30 text-red-400',
        )}
      >
        {current.text}
      </div>
    </div>
  );
}
