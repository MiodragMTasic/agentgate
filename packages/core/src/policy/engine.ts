import type { GateDecision, GateRequest } from '../context/types.js';
import {
	checkConditions,
	checkParamConstraints,
	checkRoleAccess,
	getEffectiveRoles,
} from './conditions.js';
import type { AccessRule, EvaluatedRule, PolicySet, ToolPolicy } from './types.js';

export class PolicyEngine {
	private policies: PolicySet;

	constructor(policies: PolicySet) {
		this.policies = policies;
	}

	reload(policies: PolicySet): void {
		this.policies = policies;
	}

	evaluate(request: GateRequest): GateDecision {
		const start = performance.now();
		const decisionId = `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

		const toolPolicy = this.findToolPolicy(request.tool);

		if (!toolPolicy) {
			const defaultVerdict = this.policies.defaults?.verdict ?? 'deny';
			return {
				verdict: defaultVerdict,
				reason:
					defaultVerdict === 'deny'
						? `No policy found for tool "${request.tool}" (default: deny)`
						: `No policy found for tool "${request.tool}" (default: allow)`,
				evaluationTimeMs: performance.now() - start,
				decisionId,
				timestamp: new Date(),
			};
		}

		const effectiveRoles = getEffectiveRoles(
			request.identity,
			this.policies.roles ?? {},
		);

		// Check deny rules first (deny takes precedence)
		const denyResult = this.evaluateRules(
			toolPolicy.deny,
			'deny',
			request,
			effectiveRoles,
		);
		if (denyResult) {
			return {
				verdict: 'deny',
				reason: denyResult.reason,
				matchedRule: denyResult.ruleName,
				evaluationTimeMs: performance.now() - start,
				decisionId,
				timestamp: new Date(),
			};
		}

		// Check allow rules
		const allowResult = this.evaluateRules(
			toolPolicy.allow,
			'allow',
			request,
			effectiveRoles,
		);

		if (!allowResult) {
			const defaultVerdict = this.policies.defaults?.verdict ?? 'deny';
			return {
				verdict: defaultVerdict,
				reason:
					defaultVerdict === 'deny'
						? `No allow rule matched for tool "${request.tool}" with roles [${[...effectiveRoles].join(', ')}]`
						: `Default allow for tool "${request.tool}"`,
				evaluationTimeMs: performance.now() - start,
				decisionId,
				timestamp: new Date(),
			};
		}

		// Check if approval is required
		if (toolPolicy.requireApproval) {
			const approval = toolPolicy.requireApproval;
			let needsApproval = true;

			if (approval.when) {
				needsApproval = checkRoleAccess(approval.when, effectiveRoles);
				if (approval.when.params) {
					const paramCheck = checkParamConstraints(approval.when.params, request.params);
					needsApproval = needsApproval && paramCheck.passed;
				}
			}

			if (needsApproval) {
				const approvalId = `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
				return {
					verdict: 'pending_approval',
					reason: `Tool "${request.tool}" requires approval`,
					matchedRule: allowResult.ruleName,
					approvalId,
					evaluationTimeMs: performance.now() - start,
					decisionId,
					timestamp: new Date(),
				};
			}
		}

		return {
			verdict: 'allow',
			reason: allowResult.reason,
			matchedRule: allowResult.ruleName,
			evaluationTimeMs: performance.now() - start,
			decisionId,
			timestamp: new Date(),
		};
	}

	getToolPolicy(tool: string): ToolPolicy | undefined {
		return this.findToolPolicy(tool);
	}

	getToolNames(): string[] {
		return Object.keys(this.policies.tools);
	}

	getPolicies(): PolicySet {
		return this.policies;
	}

	private findToolPolicy(tool: string): ToolPolicy | undefined {
		// Exact match first
		if (this.policies.tools[tool]) {
			return this.policies.tools[tool];
		}

		// Wildcard/glob match
		for (const [pattern, policy] of Object.entries(this.policies.tools)) {
			if (pattern.includes('*')) {
				const regex = pattern
					.replace(/\./g, '\\.')
					.replace(/\*\*/g, '{{GLOBSTAR}}')
					.replace(/\*/g, '[^.]*')
					.replace(/\{\{GLOBSTAR\}\}/g, '.*');
				if (new RegExp(`^${regex}$`).test(tool)) {
					return policy;
				}
			}
		}

		return undefined;
	}

	private evaluateRules(
		rules: AccessRule | AccessRule[] | undefined,
		type: 'allow' | 'deny',
		request: GateRequest,
		effectiveRoles: Set<string>,
	): EvaluatedRule | null {
		if (!rules) return null;

		const ruleList = Array.isArray(rules) ? rules : [rules];

		for (let i = 0; i < ruleList.length; i++) {
			const rule = ruleList[i]!;
			const ruleName = `${type}[${i}]`;

			// Check role access
			if (!checkRoleAccess(rule, effectiveRoles)) {
				if (type === 'deny') continue; // Deny rule doesn't match this role
				continue; // Allow rule doesn't match this role
			}

			// Check param constraints
			if (rule.params) {
				const paramResult = checkParamConstraints(rule.params, request.params);
				if (type === 'deny' && paramResult.passed) {
					// Deny rule: params matched a blocked pattern
					return {
						verdict: 'deny',
						reason: `Parameter "${paramResult.failedParam}" ${paramResult.failedReason}`,
						ruleName,
					};
				}
				if (type === 'deny' && !paramResult.passed) {
					// For deny rules with "contains" checks, the logic is inverted:
					// The deny rule fires when the param MATCHES the blocked pattern
					continue;
				}
				if (type === 'allow' && !paramResult.passed) {
					return null; // Allow rule's constraints not met
				}
			}

			// Check conditions
			if (rule.conditions) {
				const condResult = checkConditions(
					rule.conditions,
					request.identity,
					request.params,
				);
				if (!condResult.passed) {
					if (type === 'deny') continue;
					return null;
				}
			}

			// Rule matched
			if (type === 'deny') {
				const roles = rule.roles ? `roles [${rule.roles.join(', ')}]` : 'all roles';
				return {
					verdict: 'deny',
					reason: `Denied by ${ruleName} for ${roles}`,
					ruleName,
				};
			}

			return {
				verdict: 'allow',
				reason: `Allowed by ${ruleName} for roles [${[...effectiveRoles].join(', ')}]`,
				ruleName,
			};
		}

		return null;
	}
}
