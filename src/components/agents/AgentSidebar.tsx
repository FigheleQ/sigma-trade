'use client';

import {
	BarChart3,
	MessageCircle,
	Target,
	type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
	useNewsStore,
	selectUnreadCount,
	selectCriticalCount,
} from '@/lib/store/newsStore';
import { useCoachStore, selectCoachStatus } from '@/lib/store/coachStore';

export type AgentId =
	| 'news'
	| 'technical'
	| 'sentiment'
	| 'orchestrator'
	| 'coach';

export interface AgentMeta {
	id: AgentId;
	name: string;
	enabled: boolean;
	badgeCount: number;
	badgeVariant: 'default' | 'critical';
}

const AGENT_ICONS: Record<'technical' | 'sentiment' | 'orchestrator', LucideIcon> = {
	technical: BarChart3,
	sentiment: MessageCircle,
	orchestrator: Target,
};

// Agents rendered with a custom SVG icon — white by default, green on hover/active.
const AGENT_SVGS: Partial<Record<AgentId, { white: string; green: string }>> = {
	news: { white: '/news-agent-icon-white.svg', green: '/news-agent-icon-green.svg' },
	coach: { white: '/coach-icon-white.svg', green: '/coach-icon.svg' },
};
interface AgentSidebarProps {
  agents: AgentMeta[];
  activeAgent: AgentId | null;
  onAgentChange: (id: AgentId) => void;
}

export default function AgentSidebar({ agents, activeAgent, onAgentChange }: AgentSidebarProps) {
	// Live badge counts z newsStore — tylko dla agenta 'news'
	const newsUnread = useNewsStore(selectUnreadCount);
	const newsCritical = useNewsStore(selectCriticalCount);
	const coachStatus = useCoachStore(selectCoachStatus);
	const coachBusy = coachStatus === 'sending' || coachStatus === 'loading';

	return (
		<div className='flex md:flex-col flex-row items-center gap-3 py-4 px-2'>
			{agents.map((agent) => {
				const svg = AGENT_SVGS[agent.id];
				const Icon = !svg ? AGENT_ICONS[agent.id as keyof typeof AGENT_ICONS] : null;
				const isActive = activeAgent === agent.id;
				const isDisabled = !agent.enabled;

				// Dla agenta 'news' używamy żywych danych ze store
				const badgeCount = agent.id === 'news' ? newsUnread : agent.badgeCount;
				const badgeVariant =
					agent.id === 'news'
						? newsCritical > 0
							? ('critical' as const)
							: ('default' as const)
						: agent.badgeVariant;
				const hasBadge = badgeCount > 0;

				return (
					<div key={agent.id} className='relative group'>
						<button
							onClick={() => {
								if (!isDisabled) onAgentChange(agent.id);
							}}
							disabled={isDisabled}
							title={isDisabled ? 'Coming in Phase 2' : agent.name}
							aria-label={isDisabled ? `${agent.name} — coming in Phase 2` : agent.name}
							className={cn(
								'relative w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center',
								'bg-bg-panel border border-border-subtle',
								'transition-all duration-150',
								isActive && 'ring-2 ring-accent border-accent',
								!isDisabled &&
									!isActive &&
									'hover:scale-105 hover:shadow-[0_0_12px_rgba(0,255,136,0.25)] hover:border-accent/40',
								isDisabled && 'opacity-40 cursor-not-allowed',
								!isDisabled && 'cursor-pointer',
							)}
						>
							{svg ? (
								<>
									{/* White by default; green fades in on hover or when active. */}
									<img
										src={svg.white}
										alt={agent.name}
										className={cn(
											'absolute inset-0 w-full h-full rounded-full transition-opacity duration-150',
											agent.id === 'coach' && coachBusy && 'coach-icon-glow',
											isActive ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
										)}
									/>
									<img
										src={svg.green}
										alt=""
										aria-hidden="true"
										className={cn(
											'absolute inset-0 w-full h-full rounded-full transition-opacity duration-150',
											agent.id === 'coach' && coachBusy && 'coach-icon-glow',
											isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
										)}
									/>
								</>
							) : Icon ? (
								<Icon
									size={22}
									className={cn(
										isActive ? 'text-accent' : 'text-gray-400',
										!isDisabled && !isActive && 'group-hover:text-accent/70',
									)}
								/>
							) : null}

							{/* Badge */}
							{hasBadge && !isDisabled && (
								<span
									className={cn(
										'absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full',
										'flex items-center justify-center px-1',
										'font-mono text-[10px] font-bold text-white leading-none',
										badgeVariant === 'critical' ? 'bg-red-500' : 'bg-blue-500',
									)}
								>
									{badgeCount > 99 ? '99+' : badgeCount}
								</span>
							)}
						</button>

						{/* Tooltip for disabled agents */}
						{isDisabled && (
							<div className='absolute left-full ml-2 top-1/2 -translate-y-1/2 z-10 hidden group-hover:block'>
								<div className='bg-bg-panel border border-border-subtle rounded px-2 py-1 whitespace-nowrap'>
									<p className='font-mono text-xs text-gray-500'>
										Coming in Phase 2
									</p>
								</div>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
