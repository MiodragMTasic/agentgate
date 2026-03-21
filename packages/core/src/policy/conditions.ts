import type { Identity } from '../context/types.js';
import type {
	AccessRule,
	ParamConstraint,
	PolicyCondition,
	RoleDefinition,
	TimeCondition,
} from './types.js';

export function resolveRoles(
	role: string,
	roleDefs: Record<string, RoleDefinition>,
	seen = new Set<string>(),
): Set<string> {
	if (seen.has(role)) return seen;
	seen.add(role);

	const def = roleDefs[role];
	if (def?.inherits) {
		for (const parent of def.inherits) {
			resolveRoles(parent, roleDefs, seen);
		}
	}

	return seen;
}

export function getEffectiveRoles(
	identity: Identity,
	roleDefs: Record<string, RoleDefinition>,
): Set<string> {
	const effective = new Set<string>();
	for (const role of identity.roles) {
		for (const resolved of resolveRoles(role, roleDefs)) {
			effective.add(resolved);
		}
	}
	return effective;
}

export function checkRoleAccess(rule: AccessRule, effectiveRoles: Set<string>): boolean {
	if (!rule.roles || rule.roles.length === 0) return true;
	return rule.roles.some((r) => effectiveRoles.has(r));
}

export function checkParamConstraints(
	constraints: Record<string, ParamConstraint>,
	params: Record<string, unknown>,
): { passed: boolean; failedParam?: string; failedReason?: string } {
	for (const [paramName, constraint] of Object.entries(constraints)) {
		const value = params[paramName];

		if (constraint.forbidden) {
			if (value !== undefined) {
				return { passed: false, failedParam: paramName, failedReason: 'forbidden parameter' };
			}
			continue;
		}

		if (value === undefined) continue;

		if (constraint.pattern && typeof value === 'string') {
			if (!new RegExp(constraint.pattern).test(value)) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: `does not match pattern "${constraint.pattern}"`,
				};
			}
		}

		const textValues = normalizeTextValues(value);

		if (constraint.contains) {
			if (!textValues) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: 'must be a string or string array',
				};
			}

			if (
				!constraint.contains.some((needle) => textValues.some((entry) => entry.includes(needle)))
			) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: 'missing required content',
				};
			}
		}

		if (constraint.notContains) {
			if (!textValues) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: 'must be a string or string array',
				};
			}

			if (
				constraint.notContains.some((needle) => textValues.some((entry) => entry.includes(needle)))
			) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: 'contains blocked value',
				};
			}
		}

		if (constraint.enum) {
			if (!constraint.enum.includes(value)) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: `not in allowed values [${constraint.enum.join(', ')}]`,
				};
			}
		}

		if (constraint.min !== undefined && typeof value === 'number') {
			if (value < constraint.min) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: `below minimum ${constraint.min}`,
				};
			}
		}

		if (constraint.max !== undefined && typeof value === 'number') {
			if (value > constraint.max) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: `exceeds maximum ${constraint.max}`,
				};
			}
		}

		if (constraint.maxLength !== undefined && typeof value === 'string') {
			if (value.length > constraint.maxLength) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: `exceeds max length ${constraint.maxLength}`,
				};
			}
		}

		if (constraint.maxItems !== undefined && Array.isArray(value)) {
			if (value.length > constraint.maxItems) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: `exceeds max items ${constraint.maxItems}`,
				};
			}
		}

		if (constraint.startsWith !== undefined && typeof value === 'string') {
			if (!value.startsWith(constraint.startsWith)) {
				return {
					passed: false,
					failedParam: paramName,
					failedReason: `must start with "${constraint.startsWith}"`,
				};
			}
		}

		if (constraint.notStartsWith && typeof value === 'string') {
			for (const prefix of constraint.notStartsWith) {
				if (value.startsWith(prefix)) {
					return {
						passed: false,
						failedParam: paramName,
						failedReason: `must not start with "${prefix}"`,
					};
				}
			}
		}
	}

	return { passed: true };
}

export function checkTimeCondition(condition: TimeCondition): boolean {
	const { day, currentMinutes } = getCurrentClockParts(condition.timezone);

	if (condition.days) {
		const allowedDays = new Set(condition.days.map(normalizeDayName));
		if (!allowedDays.has(day)) {
			return false;
		}
	}

	if (condition.hours) {
		const { after, before } = condition.hours;
		const [afterH, afterM] = after.split(':').map(Number);
		const [beforeH, beforeM] = before.split(':').map(Number);

		const afterMinutes = (afterH ?? 0) * 60 + (afterM ?? 0);
		const beforeMinutes = (beforeH ?? 0) * 60 + (beforeM ?? 0);

		if (currentMinutes < afterMinutes || currentMinutes >= beforeMinutes) {
			return false;
		}
	}

	return true;
}

export function checkConditions(
	conditions: Record<string, PolicyCondition>,
	identity: Identity,
	params: Record<string, unknown>,
): { passed: boolean; failedCondition?: string } {
	for (const [name, condition] of Object.entries(conditions)) {
		if (condition.time) {
			if (!checkTimeCondition(condition.time)) {
				return { passed: false, failedCondition: name };
			}
		}

		if (condition.expression) {
			try {
				const result = evaluateExpression(condition.expression, identity, params);
				if (!result) {
					return { passed: false, failedCondition: name };
				}
			} catch {
				return { passed: false, failedCondition: name };
			}
		}
	}

	return { passed: true };
}

function evaluateExpression(
	expr: string,
	identity: Identity,
	params: Record<string, unknown>,
): boolean {
	const safeExpr = expr
		.replace(/identity\.id/g, JSON.stringify(identity.id))
		.replace(/identity\.orgId/g, JSON.stringify(identity.orgId ?? ''))
		.replace(/params\.(\w+)/g, (_match, key: string) => JSON.stringify(params[key] ?? null));

	try {
		return new Function(`return (${safeExpr})`)() as boolean;
	} catch {
		return false;
	}
}

function normalizeTextValues(value: unknown): string[] | null {
	if (typeof value === 'string') {
		return [value];
	}

	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
		return value;
	}

	return null;
}

function normalizeDayName(day: string): string {
	return day.trim().toLowerCase().slice(0, 3);
}

function getCurrentClockParts(timezone?: string): {
	day: string;
	currentMinutes: number;
} {
	const now = new Date();

	if (!timezone) {
		const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
		return {
			day: dayNames[now.getDay()] ?? 'sun',
			currentMinutes: now.getHours() * 60 + now.getMinutes(),
		};
	}

	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		const parts = formatter.formatToParts(now);
		const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'sun';
		const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
		const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
		return {
			day: normalizeDayName(weekday),
			currentMinutes: hour * 60 + minute,
		};
	} catch {
		const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
		return {
			day: dayNames[now.getDay()] ?? 'sun',
			currentMinutes: now.getHours() * 60 + now.getMinutes(),
		};
	}
}
