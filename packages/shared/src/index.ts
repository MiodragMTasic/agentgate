export function generateId(): string {
	return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function redactValue(value: unknown, replacement = '[REDACTED]'): unknown {
	if (typeof value === 'string') return replacement;
	if (typeof value === 'number') return 0;
	if (typeof value === 'boolean') return false;
	if (Array.isArray(value)) return value.map((v) => redactValue(v, replacement));
	if (value && typeof value === 'object') {
		const redacted: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			redacted[k] = redactValue(v, replacement);
		}
		return redacted;
	}
	return replacement;
}

export function matchGlob(pattern: string, value: string): boolean {
	const regex = pattern
		.replace(/\./g, '\\.')
		.replace(/\*\*/g, '{{GLOBSTAR}}')
		.replace(/\*/g, '[^.]*')
		.replace(/\{\{GLOBSTAR\}\}/g, '.*');
	return new RegExp(`^${regex}$`).test(value);
}

export function parseDuration(duration: string): number {
	const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
	if (!match) throw new Error(`Invalid duration: ${duration}`);
	const [, amount, unit] = match;
	const multipliers: Record<string, number> = {
		ms: 1,
		s: 1000,
		m: 60_000,
		h: 3_600_000,
		d: 86_400_000,
	};
	return Number(amount) * multipliers[unit]!;
}
