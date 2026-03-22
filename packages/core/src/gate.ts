import type { AuditEvent, AuditSink } from './audit/types.js';
import type { BudgetPeriod, BudgetStatus, BudgetStore } from './budget/types.js';
import type { GateDecision, GateRequest, Identity } from './context/types.js';
import type { CapabilityMap } from './discovery/types.js';
import type { ApprovalRequest, HITLTransport } from './hitl/types.js';
import type { CostConfig, PolicySet, ToolPolicy } from './policy/types.js';
import type { RateLimitRule, RateLimitStore } from './rate-limit/types.js';

import { AuditLogger } from './audit/logger.js';
import { CostRegistry } from './budget/cost-registry.js';
import { BudgetTracker } from './budget/tracker.js';
import { CapabilityDiscovery } from './discovery/capability-map.js';
import { ApprovalFlow } from './hitl/approval-flow.js';
import { PolicyEngine } from './policy/engine.js';
import { parsePolicySourceSync } from './policy/parser.js';
import { validatePolicy } from './policy/validate.js';
import { MemoryRateLimitStore } from './rate-limit/memory-store.js';
import { SlidingWindowLimiter } from './rate-limit/sliding-window.js';

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

		const policySet = this.loadPolicySet(config.policies);
		validatePolicy(policySet);

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
		this.syncBudgetRuntime(policySet);

		// Initialize HITL
		if (config.hitl) {
			this.approvalFlow = new ApprovalFlow({
				transport: config.hitl.transport,
				timeout: config.hitl.timeout ?? 300_000,
				timeoutAction: config.hitl.timeoutAction ?? 'deny',
			});
		}
	}

	private loadPolicySet(policies: string | PolicySet): PolicySet {
		if (typeof policies === 'string') {
			try {
				return parsePolicySourceSync(policies);
			} catch (err) {
				if (this.config.debug) {
					// eslint-disable-next-line no-console
					globalThis.console?.error('[AgentGate] Failed to load policies:', err);
				}
				throw err;
			}
		}

		return policies;
	}

	async evaluate(request: GateRequest): Promise<GateDecision> {
		const decision = this.engine.evaluate(request);
		const toolPolicy = this.engine.getToolPolicy(request.tool);

		if (decision.verdict === 'allow') {
			const guardedDecision = await this.applyAllowRuntimeGuards(decision, request, toolPolicy);
			if (guardedDecision) {
				return guardedDecision;
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
			const approvalTimedOut = approvalRequest.status === 'expired';

			const resolvedDecision: GateDecision = {
				...decision,
				verdict: approved ? 'allow' : 'deny',
				reason: approvalTimedOut
					? `Approval timed out for tool "${request.tool}"`
					: approved
						? `Approved: ${decision.reason}`
						: `Approval denied for tool "${request.tool}"`,
			};

			this.emit(
				approvalTimedOut ? 'approval:expired' : approved ? 'approval:approved' : 'approval:denied',
				approvalRequest,
			);

			if (resolvedDecision.verdict === 'allow') {
				const guardedDecision = await this.applyAllowRuntimeGuards(
					resolvedDecision,
					request,
					toolPolicy,
				);
				if (guardedDecision) {
					return guardedDecision;
				}
			}

			this.logDecision(resolvedDecision, request);
			return resolvedDecision;
		}

		this.logDecision(decision, request);
		return decision;
	}

	async waitForApproval(approvalId: string): Promise<boolean> {
		if (!this.approvalFlow) return false;
		return (await this.approvalFlow.waitForApproval(approvalId)) ?? false;
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
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			handlers.add(handler);
		}
	}

	off(event: string, handler: EventHandler): void {
		this.eventHandlers.get(event)?.delete(handler);
	}

	async reloadPolicies(policies: string | PolicySet): Promise<void> {
		const policySet = this.loadPolicySet(policies);
		validatePolicy(policySet);
		this.engine.reload(policySet);
		this.syncBudgetRuntime(policySet);
		this.emit('policy:reloaded', {
			source: typeof policies === 'string' ? policies : 'inline',
		});
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

	private async applyAllowRuntimeGuards(
		decision: GateDecision,
		request: GateRequest,
		toolPolicy: ReturnType<PolicyEngine['getToolPolicy']>,
	): Promise<GateDecision | null> {
		if (this.rateLimiter) {
			const rateLimit = toolPolicy?.rateLimit ?? this.engine.getPolicies().defaults?.rateLimit;
			if (rateLimit) {
				const windowMs = parseDurationLocal(rateLimit.window);
				const scope = rateLimit.scope ?? 'identity:tool';
				const key = buildRateLimitKey(scope, request);

				const rule: RateLimitRule = {
					name: request.tool,
					tools: request.tool,
					maxRequests: rateLimit.maxRequests,
					windowSeconds: windowMs / 1000,
					scope,
					strategy: rateLimit.strategy ?? 'sliding-window',
				};

				const result = await this.rateLimiter.increment(key, rule);

				if (!result.allowed) {
					const rateLimitedDecision: GateDecision = {
						...decision,
						verdict: 'deny',
						reason: `Rate limit exceeded for tool "${request.tool}" (${rateLimit.maxRequests} per ${rateLimit.window})`,
					};
					this.logDecision(rateLimitedDecision, request);
					this.emit('rate-limit:hit', { tool: request.tool, identity: request.identity });
					return rateLimitedDecision;
				}
			}
		}

		if (this.budgetTracker && this.costRegistry) {
			const cost = this.costRegistry.getCost(request.tool, request.params);
			if (cost > 0 && toolPolicy?.budget) {
				const status = await this.budgetTracker.check(request.identity, request.tool, cost);
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

		return null;
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

		void this.auditLogger.log(event).catch(() => undefined);
		this.emit('decision', event);
	}

	private syncBudgetRuntime(policySet: PolicySet): void {
		const toolPolicies = Object.entries(policySet.tools);
		const hasPolicyCosts = toolPolicies.some(([, toolPolicy]) => toolPolicy.cost !== undefined);
		const hasPolicyBudgets = toolPolicies.some(([, toolPolicy]) => toolPolicy.budget !== undefined);
		const hasConfigCosts =
			this.config.budget !== undefined && Object.keys(this.config.budget.costs).length > 0;

		if (!hasPolicyCosts && !hasPolicyBudgets && !hasConfigCosts) {
			this.costRegistry = null;
			this.budgetTracker = null;
			return;
		}

		this.costRegistry = new CostRegistry();

		for (const [tool, toolPolicy] of toolPolicies) {
			if (toolPolicy.cost !== undefined) {
				const cost = buildCostCalculator(toolPolicy.cost);
				if (typeof cost === 'number') {
					this.costRegistry.register(tool, cost);
				} else {
					this.costRegistry.register(tool, cost);
				}
			}
		}

		if (this.config.budget) {
			for (const [tool, cost] of Object.entries(this.config.budget.costs)) {
				if (typeof cost === 'number') {
					this.costRegistry.register(tool, cost);
				} else {
					this.costRegistry.register(tool, cost);
				}
			}
		}

		if (!hasPolicyBudgets) {
			this.budgetTracker = null;
			return;
		}

		this.budgetTracker = new BudgetTracker(this.config.budget?.store);

		for (const [tool, toolPolicy] of toolPolicies) {
			if (!toolPolicy.budget) {
				continue;
			}

			this.registerBudgetLimits(tool, toolPolicy);
		}
	}

	private registerBudgetLimits(tool: string, toolPolicy: ToolPolicy): void {
		if (!this.budgetTracker || !toolPolicy.budget) {
			return;
		}

		for (const [period, amount] of Object.entries(toolPolicy.budget.perUser ?? {})) {
			if (amount !== undefined) {
				this.budgetTracker.setLimit(`identity:*:tool:${tool}`, {
					scope: 'identity',
					maxAmount: amount,
					period: period as BudgetPeriod,
				});
			}
		}

		for (const [period, amount] of Object.entries(toolPolicy.budget.perOrg ?? {})) {
			if (amount !== undefined) {
				this.budgetTracker.setLimit(`org:*:tool:${tool}`, {
					scope: 'org',
					maxAmount: amount,
					period: period as BudgetPeriod,
				});
			}
		}

		for (const [period, amount] of Object.entries(toolPolicy.budget.global ?? {})) {
			if (amount !== undefined) {
				this.budgetTracker.setLimit(`global:tool:${tool}`, {
					scope: 'global',
					maxAmount: amount,
					period: period as BudgetPeriod,
				});
			}
		}
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
	const multiplier = unit ? multipliers[unit] : undefined;
	return Number(amount) * (multiplier ?? 1000);
}

function buildRateLimitKey(scope: string, request: GateRequest): string {
	switch (scope) {
		case 'identity':
			return `rl:${request.identity.id}`;
		case 'tool':
			return `rl:${request.tool}`;
		case 'global':
			return 'rl:global';
		default:
			return `rl:${request.identity.id}:${request.tool}`;
	}
}

function buildCostCalculator(
	cost: number | CostConfig,
): number | ((params: Record<string, unknown>) => number) {
	if (typeof cost === 'number') {
		return cost;
	}

	return (params: Record<string, unknown>) => {
		let total = cost.base;

		for (const [paramName, pricing] of Object.entries(cost.perParam ?? {})) {
			const value = params[paramName];
			if (value === undefined) {
				continue;
			}

			if (typeof value === 'number') {
				total += value * pricing.perUnit;
				continue;
			}

			if (typeof value === 'string') {
				total += value === pricing.unit ? pricing.perUnit : 0;
				continue;
			}

			if (typeof value === 'boolean') {
				total +=
					value && (pricing.unit === undefined || pricing.unit === 'true') ? pricing.perUnit : 0;
				continue;
			}

			if (Array.isArray(value)) {
				if (pricing.unit === undefined) {
					total += value.length * pricing.perUnit;
					continue;
				}

				total += value.filter((entry) => String(entry) === pricing.unit).length * pricing.perUnit;
			}
		}

		return total;
	};
}
