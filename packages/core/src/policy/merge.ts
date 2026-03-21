import type { PolicySet } from './types.js';

export function mergePolicies(...policySets: PolicySet[]): PolicySet {
	if (policySets.length === 0) {
		return { version: '1', tools: {} };
	}

	if (policySets.length === 1) {
		return policySets[0]!;
	}

	const merged: PolicySet = {
		version: '1',
		defaults: undefined,
		roles: {},
		tools: {},
		conditions: {},
	};

	for (const ps of policySets) {
		if (ps.defaults) {
			merged.defaults = { ...merged.defaults, ...ps.defaults };
		}

		if (ps.roles) {
			for (const [name, def] of Object.entries(ps.roles)) {
				merged.roles![name] = { ...merged.roles![name], ...def };
			}
		}

		for (const [name, policy] of Object.entries(ps.tools)) {
			if (merged.tools[name]) {
				// Later policies override earlier ones for the same tool
				merged.tools[name] = { ...merged.tools[name], ...policy };
			} else {
				merged.tools[name] = policy;
			}
		}

		if (ps.conditions) {
			for (const [name, cond] of Object.entries(ps.conditions)) {
				merged.conditions![name] = cond;
			}
		}
	}

	return merged;
}
