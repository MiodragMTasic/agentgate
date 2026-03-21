import type { Identity } from '../context/types.js';
import type { PolicyEngine } from '../policy/engine.js';
import type { AccessRule, BudgetPeriods, ToolPolicy } from '../policy/types.js';
import type { DiscoveryBudgetStatus, CapabilityMap, ToolCapability } from './types.js';

export class CapabilityDiscovery {
	private engine: PolicyEngine;

	constructor(engine: PolicyEngine) {
		this.engine = engine;
	}

	discover(identity: Identity): CapabilityMap {
		const toolNames = this.engine.getToolNames();
		const tools: ToolCapability[] = [];

		for (const tool of toolNames) {
			const capability = this.evaluateTool(tool, identity);
			tools.push(capability);
		}

		const budget = this.extractDiscoveryBudgetStatus(identity);

		return {
			identity,
			evaluatedAt: new Date(),
			tools,
			budget,
		};
	}

	private evaluateTool(tool: string, identity: Identity): ToolCapability {
		const decision = this.engine.evaluate({
			tool,
			params: {},
			identity,
		});

		const toolPolicy = this.engine.getToolPolicy(tool);
		const allowed = decision.verdict === 'allow';
		const requiresApproval = decision.verdict === 'pending_approval';

		const capability: ToolCapability = {
			tool,
			allowed: allowed || requiresApproval,
			requiresApproval,
		};

		if (toolPolicy) {
			const conditions = this.extractConditions(toolPolicy);
			if (conditions.length > 0) {
				capability.conditions = conditions;
			}

			const rateLimit = this.extractRateLimit(toolPolicy);
			if (rateLimit) {
				capability.rateLimit = rateLimit;
			}

			const budgetRemaining = this.extractToolBudget(toolPolicy, identity);
			if (budgetRemaining !== undefined) {
				capability.budgetRemaining = budgetRemaining;
			}

			const paramConstraints = this.extractParamConstraints(toolPolicy);
			if (Object.keys(paramConstraints).length > 0) {
				capability.paramConstraints = paramConstraints;
			}
		}

		return capability;
	}

	private extractConditions(policy: ToolPolicy): string[] {
		const conditions: string[] = [];

		const collectFromRules = (rules: AccessRule | AccessRule[] | undefined) => {
			if (!rules) return;
			const ruleList = Array.isArray(rules) ? rules : [rules];
			for (const rule of ruleList) {
				if (!rule.conditions) continue;
				for (const [name, condition] of Object.entries(rule.conditions)) {
					if (condition.time) {
						const time = condition.time;
						const parts: string[] = [];
						if (time.days) {
							parts.push(`days: ${time.days.join(', ')}`);
						}
						if (time.hours) {
							parts.push(`hours: ${time.hours.after}-${time.hours.before}`);
						}
						if (time.timezone) {
							parts.push(`tz: ${time.timezone}`);
						}
						conditions.push(`${name}: ${parts.join(', ')}`);
					}
					if (condition.expression) {
						conditions.push(`${name}: ${condition.expression}`);
					}
				}
			}
		};

		collectFromRules(policy.allow);
		collectFromRules(policy.deny);

		return conditions;
	}

	private extractRateLimit(
		policy: ToolPolicy,
	): { remaining: number; resetsAt: Date } | undefined {
		const rateLimit =
			policy.rateLimit ?? this.engine.getPolicies().defaults?.rateLimit;
		if (!rateLimit) return undefined;

		const windowMs = this.parseWindow(rateLimit.window);
		return {
			remaining: rateLimit.maxRequests,
			resetsAt: new Date(Date.now() + windowMs),
		};
	}

	private parseWindow(window: string): number {
		const match = window.match(/^(\d+)(s|m|h|d)$/);
		if (!match) return 60_000;

		const value = Number.parseInt(match[1]!, 10);
		const unit = match[2]!;

		switch (unit) {
			case 's':
				return value * 1_000;
			case 'm':
				return value * 60_000;
			case 'h':
				return value * 3_600_000;
			case 'd':
				return value * 86_400_000;
			default:
				return 60_000;
		}
	}

	private extractToolBudget(
		policy: ToolPolicy,
		identity: Identity,
	): number | undefined {
		if (!policy.budget) return undefined;

		const budget = policy.budget;

		if (budget.perUser) {
			return this.getLowestBudgetLimit(budget.perUser);
		}
		if (identity.orgId && budget.perOrg) {
			return this.getLowestBudgetLimit(budget.perOrg);
		}
		if (budget.global) {
			return this.getLowestBudgetLimit(budget.global);
		}

		return undefined;
	}

	private getLowestBudgetLimit(
		periods: BudgetPeriods,
	): number | undefined {
		let lowest: number | undefined;
		for (const value of Object.values(periods)) {
			if (value !== undefined && (lowest === undefined || value < lowest)) {
				lowest = value;
			}
		}
		return lowest;
	}

	private extractDiscoveryBudgetStatus(identity: Identity): DiscoveryBudgetStatus | undefined {
		const policies = this.engine.getPolicies();
		let lowestLimit: number | undefined;
		let period = 'total';
		let scope: 'user' | 'org' | 'global' = 'user';

		for (const policy of Object.values(policies.tools)) {
			if (!policy.budget) continue;

			if (policy.budget.perUser) {
				const limit = this.getLowestBudgetLimit(policy.budget.perUser);
				if (limit !== undefined && (lowestLimit === undefined || limit < lowestLimit)) {
					lowestLimit = limit;
					period = this.getLowestPeriodName(policy.budget.perUser);
					scope = 'user';
				}
			}
			if (identity.orgId && policy.budget.perOrg) {
				const limit = this.getLowestBudgetLimit(policy.budget.perOrg);
				if (limit !== undefined && (lowestLimit === undefined || limit < lowestLimit)) {
					lowestLimit = limit;
					period = this.getLowestPeriodName(policy.budget.perOrg);
					scope = 'org';
				}
			}
			if (policy.budget.global) {
				const limit = this.getLowestBudgetLimit(policy.budget.global);
				if (limit !== undefined && (lowestLimit === undefined || limit < lowestLimit)) {
					lowestLimit = limit;
					period = this.getLowestPeriodName(policy.budget.global);
					scope = 'global';
				}
			}
		}

		if (lowestLimit === undefined) return undefined;

		return {
			limit: lowestLimit,
			used: 0,
			remaining: lowestLimit,
			period,
			scope,
		};
	}

	private getLowestPeriodName(
		periods: BudgetPeriods,
	): string {
		let lowest: number | undefined;
		let name = 'total';
		for (const [key, value] of Object.entries(periods)) {
			if (value !== undefined && (lowest === undefined || value < lowest)) {
				lowest = value;
				name = key;
			}
		}
		return name;
	}

	private extractParamConstraints(
		policy: ToolPolicy,
	): Record<string, import('../policy/types.js').ParamConstraint> {
		const constraints: Record<
			string,
			import('../policy/types.js').ParamConstraint
		> = {};

		const collectFromRules = (rules: AccessRule | AccessRule[] | undefined) => {
			if (!rules) return;
			const ruleList = Array.isArray(rules) ? rules : [rules];
			for (const rule of ruleList) {
				if (!rule.params) continue;
				for (const [param, constraint] of Object.entries(rule.params)) {
					constraints[param] = { ...constraints[param], ...constraint };
				}
			}
		};

		collectFromRules(policy.allow);
		collectFromRules(policy.deny);

		return constraints;
	}
}
