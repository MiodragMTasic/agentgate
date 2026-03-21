import { PolicyValidationError } from '../errors.js';
import type { PolicySet } from './types.js';

export function validatePolicy(policy: PolicySet): void {
	const errors: string[] = [];

	if (policy.version !== '1') {
		errors.push(`Unsupported policy version: "${policy.version}". Expected "1".`);
	}

	if (policy.defaults?.verdict && !['allow', 'deny'].includes(policy.defaults.verdict)) {
		errors.push(`Invalid default verdict: "${policy.defaults.verdict}". Must be "allow" or "deny".`);
	}

	// Validate role references
	const definedRoles = new Set(Object.keys(policy.roles ?? {}));

	if (policy.roles) {
		for (const [roleName, roleDef] of Object.entries(policy.roles)) {
			if (roleDef.inherits) {
				for (const parent of roleDef.inherits) {
					if (!definedRoles.has(parent)) {
						errors.push(
							`Role "${roleName}" inherits from undefined role "${parent}"`,
						);
					}
				}
			}
		}
	}

	// Validate tool policies
	for (const [toolName, toolPolicy] of Object.entries(policy.tools)) {
		const validateRules = (
			rules: unknown,
			type: string,
		) => {
			if (!rules) return;
			const ruleList = Array.isArray(rules) ? rules : [rules];
			for (const rule of ruleList) {
				if (typeof rule !== 'object' || rule === null) {
					errors.push(`${toolName}.${type}: rule must be an object`);
					continue;
				}

				const r = rule as Record<string, unknown>;
				if (r.roles && Array.isArray(r.roles)) {
					for (const role of r.roles as string[]) {
						if (definedRoles.size > 0 && !definedRoles.has(role)) {
							errors.push(
								`${toolName}.${type}: references undefined role "${role}"`,
							);
						}
					}
				}
			}
		};

		validateRules(toolPolicy.allow, 'allow');
		validateRules(toolPolicy.deny, 'deny');

		if (toolPolicy.rateLimit) {
			if (typeof toolPolicy.rateLimit.maxRequests !== 'number' || toolPolicy.rateLimit.maxRequests <= 0) {
				errors.push(`${toolName}.rateLimit.maxRequests must be a positive number`);
			}
			if (typeof toolPolicy.rateLimit.window !== 'string') {
				errors.push(`${toolName}.rateLimit.window must be a duration string (e.g., "60s")`);
			}
		}
	}

	if (errors.length > 0) {
		throw new PolicyValidationError(errors);
	}
}
