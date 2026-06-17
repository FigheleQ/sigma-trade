'use client';
import { useState } from 'react';
import AgentSidebar, {
	type AgentId,
	type AgentMeta,
} from '@/components/agents/AgentSidebar';
import NewsFeed from '@/components/agents/NewsFeed';
import MarketView from '@/components/market/MarketView';
import ProfileButton from '@/components/ui/ProfileButton';
import type { WatchlistTicker } from '@/lib/news/types';
import { X } from 'lucide-react';
import MobileTickerDrawer from '@/components/market/MobileTickerDrawer';

interface Props {
	tickers: WatchlistTicker[];
	agents: AgentMeta[];
	intervalSeconds: number;
	autoFetch: boolean;
	userEmail: string;
}

export default function DashboardClient({
	tickers,
	agents,
	intervalSeconds,
	autoFetch,
	userEmail,
}: Props) {
	const [activeAgent, setActiveAgent] = useState<AgentId | null>(null);
	return (
		<div className='flex flex-col h-screen bg-bg-base overflow-hidden'>
			{/* TopBar */}
			<header className='h-12 flex items-center justify-between px-4 border-b border-subtle shrink-0'>
				<div className='flex items-center gap-3'>
					<div className='md:hidden'>
						<MobileTickerDrawer tickers={tickers} />
					</div>
					<span className='font-mono text-sm font-semibold text-gray-100 tracking-wide'>
						StockPilot AI
					</span>
					<span className='font-mono text-xs text-gray-600'>v0.1.0</span>
					<div className='flex items-center gap-1.5'>
						<span className='w-2 h-2 rounded-full bg-accent animate-pulse' />
						<span className='font-mono text-xs text-gray-500 uppercase tracking-wider'>
							Paper Trading
						</span>
					</div>
				</div>
				<ProfileButton email={userEmail} />
			</header>

			{/* Main 2-panel layout */}
			<div className='flex flex-col md:flex-row flex-1 overflow-hidden'>
				{/* Left panel — Market View — 60% */}
				<div className='flex-1 md:flex-none md:w-[60%] border-r border-border-subtle overflow-hidden min-h-0'>
					<MarketView tickers={tickers} />
				</div>

				{/* Right panel — Agent Workspace — 40% */}
				<div className='w-full md:w-[40%] flex overflow-hidden shrink-0 md:shrink-0'>
					{/* Agent Sidebar — 80px wide */}
					<div className='md:w-20 w-full md:shrink-0 md:border-r border-t md:border-t-0 border-border-subtle md:order-none order-last border-border-subtle overflow-y-auto flex justify-center md:block'>
						<AgentSidebar
							agents={agents}
							activeAgent={activeAgent}
							onAgentChange={setActiveAgent}
						/>
					</div>

					{/* Desktop — panel po prawej */}
					<div className='hidden md:flex flex-1 overflow-hidden'>
						{activeAgent !== null && (
							<NewsFeed
								intervalSeconds={intervalSeconds}
								autoFetch={autoFetch}
							/>
						)}
					</div>

					{/* Mobile — fullscreen overlay */}
					<div
						className={`fixed inset-0 z-50 md:hidden bg-bg-base flex flex-col transition-transform duration-300 ease-in-out ${activeAgent !== null ? 'translate-y-0' : 'translate-y-full'}`}
					>
						<div className='flex items-center justify-between px-4 h-12 border-b border-border-subtle shrink-0'>
							<span className='font-mono text-xs text-zinc-400 uppercase tracking-wider'>
								News Agent
							</span>
							<button
								onClick={() => setActiveAgent(null)}
								className='text-zinc-500 hover:text-accent'
							>
								<X size={18} />
							</button>
						</div>
						<div className='flex-1 overflow-hidden'>
							<NewsFeed
								intervalSeconds={intervalSeconds}
								autoFetch={autoFetch}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
