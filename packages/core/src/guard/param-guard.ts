import type { ParamGuardRule } from './types.js';

export class ParamGuard {
	private rules: ParamGuardRule[] = [];

	addRule(rule: ParamGuardRule): this {
		this.rules.push(rule);
		return this;
	}

	pattern(param: string, regex: RegExp, message?: string): this {
		return this.addRule({
			param,
			check: (v) => typeof v === 'string' && regex.test(v),
			message: message ?? `Parameter "${param}" does not match required pattern`,
		});
	}

	maxLength(param: string, max: number): this {
		return this.addRule({
			param,
			check: (v) => typeof v === 'string' && v.length <= max,
			message: `Parameter "${param}" exceeds max length of ${max}`,
		});
	}

	range(param: string, min: number, max: number): this {
		return this.addRule({
			param,
			check: (v) => typeof v === 'number' && v >= min && v <= max,
			message: `Parameter "${param}" must be between ${min} and ${max}`,
		});
	}

	oneOf(param: string, allowed: unknown[]): this {
		return this.addRule({
			param,
			check: (v) => allowed.includes(v),
			message: `Parameter "${param}" must be one of [${allowed.join(', ')}]`,
		});
	}

	required(param: string): this {
		return this.addRule({
			param,
			check: (v) => v !== undefined && v !== null,
			message: `Parameter "${param}" is required`,
		});
	}

	forbidden(param: string): this {
		return this.addRule({
			param,
			check: (v) => v === undefined,
			message: `Parameter "${param}" is forbidden`,
		});
	}

	notStartsWith(param: string, prefixes: string[]): this {
		return this.addRule({
			param,
			check: (v) =>
				typeof v !== 'string' || !prefixes.some((p) => v.startsWith(p)),
			message: `Parameter "${param}" must not start with [${prefixes.join(', ')}]`,
		});
	}

	maxItems(param: string, max: number): this {
		return this.addRule({
			param,
			check: (v) => !Array.isArray(v) || v.length <= max,
			message: `Parameter "${param}" exceeds max items of ${max}`,
		});
	}

	custom(param: string, check: (value: unknown) => boolean, message: string): this {
		return this.addRule({ param, check, message });
	}

	validate(params: Record<string, unknown>): {
		valid: boolean;
		errors: Array<{ param: string; message: string }>;
	} {
		const errors: Array<{ param: string; message: string }> = [];

		for (const rule of this.rules) {
			const value = params[rule.param];
			if (!rule.check(value)) {
				errors.push({ param: rule.param, message: rule.message });
			}
		}

		return { valid: errors.length === 0, errors };
	}
}

export function createParamGuard(): ParamGuard {
	return new ParamGuard();
}
