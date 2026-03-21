import type { GateDecision, GateRequest, Identity } from './context/types.js';
import type { AuditEvent, AuditSink } from './audit/types.js';
import type { BudgetStatus, BudgetStore } from './budget/types.js';
import type { CapabilityMap } from './discovery/types.js';
import type { ApprovalRequest, HITLTransport } from './hitl/types.js';
import type { RateLimitRule, RateLimitStore } from './rate-limit/types.js';
import type { PolicySet } from './policy/types.js';

import { PolicyEngine } from './policy/engine.js';
import { parsePolicyFromFile, parsePolicyFromYaml } from './policy/parser.js';
import { validatePolicy } from './policy/validate.js';
import { AuditLogger } from './audit/logger.js';
import { BudgetTracker } from './budget/tracker.js';
import { CostRegistry } from './budget/cost-registry.js';
import { SlidingWindowLimiter } from './rate-limit/sliding-window.js';
import { MemoryRateLimitStore } from './rate-limit/memory-store.js';
import { ApprovalFlow } from './hitl/approval-flow.js';
import { CapabilityDiscovery } from './discovery/capability-map.js';

type EventHandler = (...args: unknown[]) => void;

export interface AgentGateConfig {
	policies: string | PolicySet;
	rateLimitStore?: RateLimitStore;
	audit?: {
		sinks: AuditSink[];
		logAllowed?: boolean;
		redactParams?: string[];
	};
	hitl?: {
		transport: HITLTransport;
		timeout?: number;
		timeoutAction?: 'deny' | 'allow';
	};
	budget?: {
		costs: Record<string, number | ((params: unknown) => number)>;
		store?: BudgetStore;
	};
	debug?: boolean;
}

export class AgentGate {
	private engine: PolicyEngine;
	private auditLogger: AuditLogger | null = null;
	private budgetTracker: BudgetTracker | null = null;
	private costRegistry: CostRegistry | null = null;
	private rateLimiter: SlidingWindowLimiter | null = null;
	private approvalFlow: ApprovalFlow | null = null;
	private discovery: CapabilityDiscovery;
	private eventHandlers = new Map<string, Set<EventHandler>>();
	private config: AgentGateConfig;

	constructor(config: AgentGateConfig) {
		this.config = config;

		// Initialize policy engine
		let policySet: PolicySet;
		if (typeof config.policies === 'string') {
			policySet = { version: '1', tools: {} };
		} else {
			policySet = config.policies;
		}

		this.engine = new PolicyEngine(policySet);
		this.discovery = new CapabilityDiscovery(this.engine);

		// Initialize audit
		if (config.audit) {
			this.auditLogger = new AuditLogger(config.audit.sinks, {
				logAllowed: config.audit.logAllowed ?? true,
				redactParams: config.audit.redactParams ?? [],
			});
		}

		// Initialize rate limiter
		this.rateLimiter = new SlidingWindowLimiter(
			config.rateLimitStore ?? new MemoryRateLimitStore(),
		);

		// Initialize budget
		if (config.budget) {
			this.costRegistry = new CostRegistry();
			for (const [tool, cost] of Object.entries(config.budget.costs)) {
				if (typeof cost === 'number') {
					this.costRegistry.register(tool, cost);
				} else {
					this.costRegistry.register(tool, cost);
				}
			}
			this.budgetTracker = new BudgetTracker(config.budget.store);
		}

		// Initialize HITL
		if (config.hitl) {
			this.approvalFlow = new ApprovalFlow({
				transport: config.hitl.transport,
				timeout: config.hitl.timeout ?? 300_000,
				timeoutAction: config.hitl.timeoutAction ?? 'deny',
			});
		}

		// Load async policies if string path/yaml provided
		if (typeof config.policies === 'string') {
			this.loadPoliciesAsync(config.policies);
		}
	}

	private async loadPoliciesAsync(source: string): Promise<void> {
		try {
			let policySet: PolicySet;
			if (source.trim().startsWith('{') || source.trim().startsWith('version')) {
				policySet = await parsePolicyFromYaml(source);
			} else {
				policySet = await parsePolicyFromFile(source);
			}
			validatePolicy(policySet);
			this.engine.reload(policySet);
			this.emit('policy:reloaded', { source });
		} catch (err) {
			if (this.config.debug) {
				// eslint-disable-next-line no-console
				globalThis.console?.error('[AgentGate] Failed to load policies:', err);
			}
			throw err;
		}
	}

	async evaluate(request: GateRequest): Promise<GateDecision> {
		const decision = this.engine.evaluate(request);

		// Check rate limits
		if (decision.verdict === 'allow' && this.rateLimiter) {
			const toolPolicy = this.engine.getToolPolicy(request.tool);
			if (toolPolicy?.rateLimit) {
				const windowMs = parseDurationLocal(toolPolicy.rateLimit.window);
				const scope = toolPolicy.rateLimit.scope ?? 'identity:tool';
				const key = buildRateLimitKey(scope, request);

				const rule: RateLimitRule = {
					name: request.tool,
					tools: request.tool,
					maxRequests: toolPolicy.rateLimit.maxRequests,
					windowSeconds: windowMs / 1000,
					scope,
					strategy: toolPolicy.rateLimit.strategy ?? 'sliding-window',
				};

				const result = await this.rateLimiter.increment(key, rule);

				if (!result.allowed) {
					const rateLimitedDecision: GateDecision = {
						...decision,
						verdict: 'deny',
						reason: `Rate limit exceeded for tool "${request.tool}" (${toolPolicy.rateLimit.maxRequests} per ${toolPolicy.rateLimit.window})`,
					};
					this.logDecision(rateLimitedDecision, request);
					this.emit('rate-limit:hit', { tool: request.tool, identity: request.identity });
					return rateLimitedDecision;
				}
			}
		}

		// Check budget
		if (decision.verdict === 'allow' && this.budgetTracker && this.costRegistry) {
			const cost = this.costRegistry.getCost(request.tool, request.params);
			if (cost > 0) {
				const toolPolicy = this.engine.getToolPolicy(request.tool);
				if (toolPolicy?.budget?.perUser) {
					const status = await this.budgetTracker.check(
						request.identity,
						request.tool,
						cost,
					);
					if (status.isExceeded) {
						const budgetDecision: GateDecision = {
							...decision,
							verdict: 'deny',
							reason: `Budget exceeded for tool "${request.tool}" (spent ${status.spent} of ${status.limit})`,
						};
						this.logDecision(budgetDecision, request);
						this.emit('budget:exceeded', {
							tool: request.tool,
							identity: request.identity,
							status,
						});
						return budgetDecision;
					}
					await this.budgetTracker.record(request.identity, request.tool, cost);
				}
			}
		}

		// Handle approval
		if (decision.verdict === 'pending_approval' && this.approvalFlow && decision.approvalId) {
			const approvalRequest: ApprovalRequest = {
				id: decision.approvalId,
				tool: request.tool,
				params: request.params,
				identity: request.identity,
				reason: decision.reason,
				matchedRule: decision.matchedRule ?? '',
				requestedAt: new Date(),
				expiresAt: new Date(Date.now() + (this.config.hitl?.timeout ?? 300_000)),
				status: 'pending',
			};

			this.emit('approval:requested', approvalRequest);

			const approved = await this.approvalFlow.requestApproval(approvalRequest);

			const resolvedDecision: GateDecision = {
				...decision,
				verdict: approved ? 'allow' : 'deny',
				reason: approved
					? `Approved: ${decision.reason}`
					: `Approval denied for tool "${request.tool}"`,
			};

			this.emit(approved ? 'approval:approved' : 'approval:denied', approvalRequest);
			this.logDecision(resolvedDecision, request);
			return resolvedDecision;
		}

		this.logDecision(decision, request);
		return decision;
	}

	async waitForApproval(_approvalId: string): Promise<boolean> {
		if (!this.approvalFlow) return false;
		return false;
	}

	discover(identity: Identity): CapabilityMap {
		return this.discovery.discover(identity);
	}

	async getBudget(identity: Identity): Promise<BudgetStatus | null> {
		if (!this.budgetTracker) return null;
		return this.budgetTracker.getStatus(identity);
	}

	on(event: string, handler: EventHandler): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, new Set());
		}
		this.eventHandlers.get(event)!.add(handler);
	}

	off(event: string, handler: EventHandler): void {
		this.eventHandlers.get(event)?.delete(handler);
	}

	async reloadPolicies(policies: string | PolicySet): Promise<void> {
		if (typeof policies === 'string') {
			await this.loadPoliciesAsync(policies);
		} else {
			validatePolicy(policies);
			this.engine.reload(policies);
			this.emit('policy:reloaded', { source: 'inline' });
		}
	}

	async shutdown(): Promise<void> {
		if (this.auditLogger) {
			await this.auditLogger.flush();
		}
		if (this.config.hitl?.transport?.close) {
			await this.config.hitl.transport.close();
		}
	}

	getEngine(): PolicyEngine {
		return this.engine;
	}

	private emit(event: string, data: unknown): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(data);
				} catch {
					// Swallow handler errors
				}
			}
		}
	}

	private logDecision(decision: GateDecision, request: GateRequest): void {
		if (!this.auditLogger) return;

		const eventType =
			decision.verdict === 'allow'
				? 'tool:allowed'
				: decision.verdict === 'deny'
					? 'tool:denied'
					: 'tool:pending';

		const event: AuditEvent = {
			id: decision.decisionId,
			timestamp: decision.timestamp,
			type: eventType as AuditEvent['type'],
			tool: request.tool,
			identity: request.identity,
			decision,
			params: request.params,
			evaluationMs: decision.evaluationTimeMs,
		};

		this.auditLogger.log(event);
		this.emit('decision', event);
	}
}

function parseDurationLocal(duration: string): number {
	const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
	if (!match) return 60_000;
	const [, amount, unit] = match;
	const multipliers: Record<string, number> = {
		ms: 1,
		s: 1000,
		m: 60_000,
		h: 3_600_000,
		d: 86_400_000,
	};
	return Number(amount) * (multipliers[unit!] ?? 1000);
}

function buildRateLimitKey(scope: string, request: GateRequest): string {
	switch (scope) {
		case 'identity':
			return `rl:${request.identity.id}`;
		case 'tool':
			return `rl:${request.tool}`;
		case 'global':
			return 'rl:global';
		case 'identity:tool':
		default:
			return `rl:${request.identity.id}:${request.tool}`;
	}
}
