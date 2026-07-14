'use client';

import { useState, useCallback } from 'react';
import { useNewsStore, selectArticles, selectFetchStatus, selectLastFetchedAt } from '@/lib/store/newsStore';
import { useNewsFetch } from '@/hooks/useNewsFetch';
import { cn } from '@/lib/utils';
import type { AnalyzedArticle } from '@/lib/news/types';
import { RefreshCw, AlertTriangle, ExternalLink, Loader2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { AiAnalysisBlock } from '@/components/news/AiAnalysisBlock';
import { Tooltip, TooltipProvider, urgencyTooltip, impactScoreTooltip } from '@/components/ui/Tooltip';

// ----------------------------------------------------------------
// Props
// ----------------------------------------------------------------

interface NewsFeedProps {
  intervalSeconds: number;
  autoFetch: boolean;
}

// ----------------------------------------------------------------
// Design tokens
// ----------------------------------------------------------------

const URGENCY_STYLES = {
  low: 'text-gray-500 border-gray-700',
  medium: 'text-blue-400 border-blue-800',
  high: 'text-amber-400 border-amber-800',
  critical: 'text-red-400 border-red-800',
} as const;

const URGENCY_LABELS = {
  low: 'Low Impact',
  medium: 'Notable',
  high: 'High Impact',
  critical: 'Critical Alert',
} as const;

const IMPACT_COLOR = (score: number) => {
  if (score >= 0.3) return 'bg-accent';
  if (score <= -0.3) return 'bg-red-500';
  return 'bg-gray-600';
};

// ----------------------------------------------------------------
// ArticleCard
// ----------------------------------------------------------------

function ArticleCard({
  article,
  isRead,
  isAnalyzing,
  analyzeError,
  onRead,
  onAnalyze,
}: {
  article: AnalyzedArticle;
  isRead: boolean;
  isAnalyzing: boolean;
  analyzeError: string | null;
  onRead: (id: number) => void;
  onAnalyze: (article: AnalyzedArticle) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // tags.length > 0 = rzeczywista analiza AI (fallback zawsze ma tags: [])
  const isAnalyzed = article.tags.length > 0;
  const impactPct = Math.abs(article.impactScore) * 100;
  const impactSign = article.impactScore >= 0 ? '+' : '';

  function handleClick() {
    onRead(article.id);
    if (!isAnalyzed && !isAnalyzing) {
      onAnalyze(article);
    }
  }

  function handleToggleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    setIsExpanded((v) => !v);
  }

  return (
    <article
      onClick={handleClick}
      className={cn(
        'px-4 py-3 border-b border-border-subtle cursor-pointer transition-colors',
        'hover:bg-bg-panel',
        isRead && !isAnalyzing && !isAnalyzed ? 'opacity-50' : 'opacity-100',
        article.urgency === 'critical' && !isRead && 'border-l-2 border-l-red-500',
        article.urgency === 'high' && !isRead && 'border-l-2 border-l-amber-500',
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        {isAnalyzed ? (
          <Tooltip content={urgencyTooltip(article.urgency)} side="top" align="start">
            <span
              className={cn(
                'font-mono text-[10px] uppercase tracking-wider border px-1 rounded shrink-0 cursor-help',
                URGENCY_STYLES[article.urgency],
              )}
            >
              {URGENCY_LABELS[article.urgency]}
            </span>
          </Tooltip>
        ) : (
          <span className="font-mono text-[10px] text-gray-700 shrink-0">—</span>
        )}
        <span className="font-mono text-[10px] text-zinc-500 shrink-0">
          {formatTimeAgo(article.publishedAt)}
        </span>
      </div>

      {/* Headline */}
      <h3 className={cn(
        'font-mono text-xs font-bold leading-snug mb-2 line-clamp-2',
        isAnalyzed ? 'text-white' : 'text-zinc-400',
      )}>
        {article.headline}
      </h3>

      {/* Interpretation / hint */}
      {isAnalyzing ? (
        <div className="flex items-center gap-1.5 mb-2">
          <Loader2 size={11} className="text-accent animate-spin shrink-0" />
          <span className="font-mono text-[11px] text-accent/70">Analyzing…</span>
        </div>
      ) : isAnalyzed ? (
        <AiAnalysisBlock className="mb-2">
          <p className={cn(
            'font-mono text-[11px] leading-snug',
            !isExpanded && 'line-clamp-2',
          )}>
            {article.interpretation}
          </p>

          {/* Expanded details */}
          {isExpanded && (
            <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-zinc-500 uppercase">Category</span>
                <span className="font-mono text-[10px] capitalize">{article.category}</span>
              </div>
              {article.tags.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[10px] text-zinc-500 uppercase">Tags</span>
                  {article.tags.map((tag) => (
                    <span
                      key={tag}
                      className="font-mono text-[10px] border border-white/20 px-1 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Expand / collapse toggle */}
          <button
            onClick={handleToggleExpand}
            className="flex items-center gap-0.5 mt-1.5 font-mono text-[10px] text-zinc-500 hover:text-white transition-colors"
          >
            {isExpanded ? (
              <><ChevronUp size={10} /> Show less</>
            ) : (
              <><ChevronDown size={10} /> Show full analysis</>
            )}
          </button>
        </AiAnalysisBlock>
      ) : analyzeError ? (
        <div className="flex items-center gap-1 mb-2">
          <AlertTriangle size={10} className="text-red-500 shrink-0" />
          <span className="font-mono text-[11px] text-red-500 line-clamp-1">{analyzeError}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 mb-2">
          <Sparkles size={10} className="text-zinc-600 shrink-0" />
          <span className="font-mono text-[11px] text-zinc-600">Click to analyze</span>
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center gap-2">
        {/* Impact bar */}
        <div className="flex items-center gap-1 shrink-0">
          {isAnalyzed ? (
            <Tooltip content={impactScoreTooltip(article.impactScore)} side="top" align="start">
              <span className="font-mono text-[10px] text-white cursor-help whitespace-pre-line">
                {impactSign}{article.impactScore.toFixed(2)}
              </span>
            </Tooltip>
          ) : (
            <span className="font-mono text-[10px] text-zinc-600">
              {impactSign}{article.impactScore.toFixed(2)}
            </span>
          )}
          <div className="w-12 h-1 rounded bg-gray-800 overflow-hidden">
            {isAnalyzed && (
              <div
                className={cn('h-full rounded', IMPACT_COLOR(article.impactScore))}
                style={{ width: `${impactPct}%` }}
              />
            )}
          </div>
        </div>

        {/* Tickers */}
        <div className="flex gap-1 flex-wrap">
          {article.tickers.map((t) => (
            <span key={t} className="font-mono text-[10px] text-accent/70">{t}</span>
          ))}
        </div>

        {/* Source link */}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-zinc-600 hover:text-white transition-colors"
        >
          <ExternalLink size={11} />
        </a>
      </div>
    </article>
  );
}

// ----------------------------------------------------------------
// Empty state
// ----------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <div className="w-10 h-10 rounded-full border border-border-subtle flex items-center justify-center">
        <span className="text-zinc-600 text-lg">✦</span>
      </div>
      <p className="font-mono text-sm text-zinc-500">No news yet</p>
      <p className="font-mono text-xs text-zinc-600">Fetching on startup…</p>
    </div>
  );
}

// ----------------------------------------------------------------
// Main component
// ----------------------------------------------------------------

export default function NewsFeed({ intervalSeconds, autoFetch }: NewsFeedProps) {
  const articles = useNewsStore(selectArticles);
  const fetchStatus = useNewsStore(selectFetchStatus);
  const lastFetchedAt = useNewsStore(selectLastFetchedAt);
  const markRead = useNewsStore((s) => s.markRead);
  const updateArticle = useNewsStore((s) => s.updateArticle);
  const readIds = useNewsStore((s) => s.readIds);

  const { fetchNow } = useNewsFetch({ intervalSeconds, autoFetch });

  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());
  const [analyzeErrors, setAnalyzeErrors] = useState<Map<number, string>>(new Map());

  const handleAnalyze = useCallback(async (article: AnalyzedArticle) => {
    setAnalyzeErrors((prev) => { const m = new Map(prev); m.delete(article.id); return m; });
    setAnalyzingIds((prev) => new Set(prev).add(article.id));

    try {
      console.log('[analyze] sending article:', { id: article.id, headline: article.headline, url: article.url });
      const res = await fetch('/api/news/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article }),
      });
      console.log('[analyze] response status:', res.status);
      const data = await res.json() as { article?: AnalyzedArticle; message?: string };
      console.log('[analyze] response body:', data);
      if (res.ok && data.article) {
        console.log('[analyze] updateArticle:', { id: data.article.id, tags: data.article.tags, impactScore: data.article.impactScore });
        updateArticle(data.article);
      } else {
        const msg = res.status === 429
          ? 'Rate limited — try again in a moment'
          : (data.message ?? `Error ${res.status}`);
        setAnalyzeErrors((prev) => new Map(prev).set(article.id, msg));
        console.warn('[NewsFeed] analyze failed:', res.status, data);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setAnalyzeErrors((prev) => new Map(prev).set(article.id, msg));
      console.warn('[NewsFeed] analyze error:', err);
    } finally {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(article.id);
        return next;
      });
    }
  }, [updateArticle]);

  // The agent is "working" while fetching the feed or analyzing any article.
  const isBusy = fetchStatus === 'fetching' || analyzingIds.size > 0;

  const lastFetchedStr = lastFetchedAt
    ? new Date(lastFetchedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2">
            <img
              src="/news-agent-icon-green.svg"
              alt="News Agent"
              width={32}
              height={32}
              className={cn('rounded shrink-0', isBusy && 'coach-icon-glow')}
            />
            <span className="font-mono text-xs text-zinc-400 uppercase tracking-wider">News Agent</span>
            {fetchStatus === 'fetching' && (
              <span className="font-mono text-[10px] text-accent animate-pulse">fetching…</span>
            )}
            {fetchStatus === 'error' && (
              <AlertTriangle size={12} className="text-red-400" />
            )}
            {lastFetchedStr && fetchStatus !== 'fetching' && (
              <span className="font-mono text-[10px] text-zinc-600">{lastFetchedStr}</span>
            )}
          </div>
          <button
            onClick={() => void fetchNow()}
            disabled={fetchStatus === 'fetching'}
            className={cn(
              'text-zinc-600 hover:text-accent transition-colors',
              fetchStatus === 'fetching' && 'opacity-40 cursor-not-allowed',
            )}
            title="Fetch now"
            aria-label="Fetch news now"
          >
            <RefreshCw size={13} className={fetchStatus === 'fetching' ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Article list */}
        <div className="flex-1 overflow-y-auto">
          {articles.length === 0 ? (
            <EmptyState />
          ) : (
            articles.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                isRead={readIds.has(article.id)}
                isAnalyzing={analyzingIds.has(article.id)}
                analyzeError={analyzeErrors.get(article.id) ?? null}
                onRead={markRead}
                onAnalyze={handleAnalyze}
              />
            ))
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function formatTimeAgo(publishedAt: number): string {
  const diffMs = Date.now() - publishedAt;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}
