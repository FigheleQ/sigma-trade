import { loadConfig } from '@/lib/config';
import DashboardClient from './DashboardClient';
import { type AgentId, type AgentMeta } from '@/components/agents/AgentSidebar';
import { createClient } from '@/lib/supabase/server';
export default async function DashboardPage() {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();

	const config = loadConfig();
	const tickers = config.watchlist.tickers;
	const features = config.features;

	const agents: AgentMeta[] = [
		{
			id: 'news' as AgentId,
			name: 'News Agent',
			enabled: features.news_agent.enabled,
			badgeCount: 0, // live z newsStore — obsługiwane w AgentSidebar
			badgeVariant: 'default',
		},
		{
			id: 'technical' as AgentId,
			name: 'Technical Agent',
			enabled: features.technical_agent.enabled,
			badgeCount: 0,
			badgeVariant: 'default',
		},
		{
			id: 'sentiment' as AgentId,
			name: 'Sentiment Agent',
			enabled: features.sentiment_agent.enabled,
			badgeCount: 0,
			badgeVariant: 'default',
		},
		{
			id: 'orchestrator' as AgentId,
			name: 'Orchestrator',
			enabled: features.orchestrator_agent.enabled,
			badgeCount: 0,
			badgeVariant: 'default',
		},
		{
			id: 'coach' as AgentId,
			name: 'Coach Agent',
			enabled: features.coach_agent.enabled,
			badgeCount: 0,
			badgeVariant: 'default',
		},
	];

	return (
		<DashboardClient
			tickers={tickers}
			agents={agents}
			intervalSeconds={features.news_agent.fetch_interval_seconds}
			autoFetch={features.news_agent.auto_fetch}
			userEmail={user?.email ?? ''}
		/>
	);
}
