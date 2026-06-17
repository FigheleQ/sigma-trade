'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

const FEATURES = [
  { label: 'Real-time market data', sub: 'Live quotes powered by Finnhub & TwelveData' },
  { label: 'AI agent team', sub: 'News, technical, and sentiment agents working in parallel' },
  { label: 'Risk-free paper trading', sub: 'Practice strategies without real capital at stake' },
];

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className='min-h-screen bg-bg-base flex flex-col md:flex-row'>

      {/* Left — sign in */}
      <div className='flex-1 flex items-center justify-center px-8 py-16'>
        <div className='w-full max-w-sm'>
          {/* Logo */}
          <div className='flex items-center gap-2 mb-10'>
            <span className='w-2 h-2 rounded-full bg-accent shrink-0' />
            <span className='font-mono text-sm font-semibold text-gray-100 tracking-wide'>
              StockPilot AI
            </span>
          </div>

          <h1 className='font-mono text-2xl font-semibold text-gray-100 mb-1'>
            Sign in
          </h1>
          <p className='font-mono text-xs text-gray-600 mb-8'>
            Enter your credentials to access the dashboard.
          </p>

          <form onSubmit={handleSubmit} className='flex flex-col gap-5'>
            <div className='flex flex-col gap-1.5'>
              <label className='font-mono text-xs text-gray-500 uppercase tracking-wider'>
                Email
              </label>
              <input
                type='email'
                required
                autoComplete='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={cn(
                  'w-full px-3 py-2.5',
                  'bg-bg-panel border border-subtle rounded-lg',
                  'font-mono text-sm text-gray-100',
                  'placeholder:text-gray-700',
                  'focus:outline-none focus:border-accent/60',
                  'transition-colors duration-150',
                )}
                placeholder='you@example.com'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label className='font-mono text-xs text-gray-500 uppercase tracking-wider'>
                Password
              </label>
              <input
                type='password'
                required
                autoComplete='current-password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(
                  'w-full px-3 py-2.5',
                  'bg-bg-panel border border-subtle rounded-lg',
                  'font-mono text-sm text-gray-100',
                  'placeholder:text-gray-700',
                  'focus:outline-none focus:border-accent/60',
                  'transition-colors duration-150',
                )}
                placeholder='••••••••'
              />
            </div>

            <p className={cn('font-mono text-xs text-red-400 min-h-[1rem]', !error && 'invisible')}>
              {error ?? ' '}
            </p>

            <button
              type='submit'
              disabled={!canSubmit || loading}
              className={cn(
                'w-full py-2.5 rounded-lg',
                'font-mono text-xs font-semibold tracking-wider uppercase',
                'bg-accent text-bg-base',
                'transition-all duration-150',
                'hover:brightness-110',
                'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:brightness-100',
              )}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>

      {/* Divider */}
      <div className='hidden md:block w-px bg-subtle' />

      {/* Right — marketing */}
      <div className='hidden md:flex flex-1 flex-col justify-center px-16 bg-bg-panel'>
        <p className='font-mono text-xs text-accent uppercase tracking-widest mb-6'>
          Paper Trading Platform
        </p>
        <h2 className='font-mono text-3xl font-semibold text-gray-100 leading-snug mb-10'>
          Learn trading<br />effortlessly with<br />
          <span className='text-accent'>StockPilot AI</span>
        </h2>

        <ul className='flex flex-col gap-6'>
          {FEATURES.map((f) => (
            <li key={f.label} className='flex items-start gap-3'>
              <span className='mt-1 w-1.5 h-1.5 rounded-full bg-accent shrink-0' />
              <div>
                <p className='font-mono text-sm text-gray-200 font-semibold'>{f.label}</p>
                <p className='font-mono text-xs text-gray-600 mt-0.5'>{f.sub}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className='mt-16 font-mono text-xs text-gray-700 uppercase tracking-widest'>
          v0.1.0 &nbsp;·&nbsp; Paper trading only
        </div>
      </div>

    </div>
  );
}
