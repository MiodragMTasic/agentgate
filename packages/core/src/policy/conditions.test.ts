import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	checkConditions,
	checkParamConstraints,
	checkRoleAccess,
	checkTimeCondition,
	getEffectiveRoles,
	resolveRoles,
} from './conditions.js';

describe('resolveRoles', () => {
	it('returns the role itself when no inheritance', () => {
		const result = resolveRoles('user', {});
		expect([...result]).toEqual(['user']);
	});

	it('resolves single-level inheritance', () => {
		const roles = {
			admin: { inherits: ['user'] },
			user: {},
		};
		const result = resolveRoles('admin', roles);
		expect(result.has('admin')).toBe(true);
		expect(result.has('user')).toBe(true);
	});

	it('resolves multi-level inheritance chain', () => {
		const roles = {
			superadmin: { inherits: ['admin'] },
			admin: { inherits: ['power_user'] },
			power_user: { inherits: ['user'] },
			user: {},
		};
		const result = resolveRoles('superadmin', roles);
		expect(result.has('superadmin')).toBe(true);
		expect(result.has('admin')).toBe(true);
		expect(result.has('power_user')).toBe(true);
		expect(result.has('user')).toBe(true);
	});

	it('handles circular inheritance without infinite loop', () => {
		const roles = {
			a: { inherits: ['b'] },
			b: { inherits: ['a'] },
		};
		const result = resolveRoles('a', roles);
		expect(result.has('a')).toBe(true);
		expect(result.has('b')).toBe(true);
	});

	it('handles multiple parents', () => {
		const roles = {
			hybrid: { inherits: ['reader', 'writer'] },
			reader: {},
			writer: {},
		};
		const result = resolveRoles('hybrid', roles);
		expect(result.has('hybrid')).toBe(true);
		expect(result.has('reader')).toBe(true);
		expect(result.has('writer')).toBe(true);
	});
});

describe('getEffectiveRoles', () => {
	it('returns effective roles for identity with single role', () => {
		const identity = { id: 'u1', roles: ['admin'] };
		const roleDefs = {
			admin: { inherits: ['user'] },
			user: {},
		};
		const result = getEffectiveRoles(identity, roleDefs);
		expect(result.has('admin')).toBe(true);
		expect(result.has('user')).toBe(true);
	});

	it('merges roles from multiple identity roles', () => {
		const identity = { id: 'u1', roles: ['reader', 'writer'] };
		const roleDefs = {
			reader: {},
			writer: {},
		};
		const result = getEffectiveRoles(identity, roleDefs);
		expect(result.has('reader')).toBe(true);
		expect(result.has('writer')).toBe(true);
	});
});

describe('checkRoleAccess', () => {
	it('returns true when rule has no roles (open access)', () => {
		expect(checkRoleAccess({}, new Set(['user']))).toBe(true);
	});

	it('returns true when rule has empty roles array', () => {
		expect(checkRoleAccess({ roles: [] }, new Set(['user']))).toBe(true);
	});

	it('returns true when identity has a matching role', () => {
		expect(checkRoleAccess({ roles: ['admin'] }, new Set(['admin', 'user']))).toBe(true);
	});

	it('returns false when identity has no matching role', () => {
		expect(checkRoleAccess({ roles: ['admin'] }, new Set(['user']))).toBe(false);
	});
});

describe('checkParamConstraints', () => {
	it('passes when no constraints violated', () => {
		const result = checkParamConstraints({}, { any: 'value' });
		expect(result.passed).toBe(true);
	});

	describe('pattern', () => {
		it('passes when string matches pattern', () => {
			const result = checkParamConstraints(
				{ path: { pattern: '^/safe/' } },
				{ path: '/safe/file.txt' },
			);
			expect(result.passed).toBe(true);
		});

		it('fails when string does not match pattern', () => {
			const result = checkParamConstraints(
				{ path: { pattern: '^/safe/' } },
				{ path: '/etc/passwd' },
			);
			expect(result.passed).toBe(false);
			expect(result.failedParam).toBe('path');
			expect(result.failedReason).toContain('pattern');
		});
	});

	describe('contains', () => {
		it('passes when value contains a required string', () => {
			const result = checkParamConstraints(
				{ query: { contains: ['SELECT', 'WITH'] } },
				{ query: 'SELECT * FROM users' },
			);
			expect(result.passed).toBe(true);
		});

		it('fails when value does not contain any required string', () => {
			const result = checkParamConstraints(
				{ query: { contains: ['SELECT', 'WITH'] } },
				{ query: 'DROP TABLE users' },
			);
			expect(result.passed).toBe(false);
			expect(result.failedParam).toBe('query');
			expect(result.failedReason).toContain('required content');
		});
	});

	describe('notContains', () => {
		it('passes when value does not contain blocked strings', () => {
			const result = checkParamConstraints(
				{ query: { notContains: ['DROP', 'DELETE'] } },
				{ query: 'SELECT * FROM users' },
			);
			expect(result.passed).toBe(true);
		});

		it('fails when value contains a blocked string', () => {
			const result = checkParamConstraints(
				{ query: { notContains: ['DROP', 'DELETE'] } },
				{ query: 'DROP TABLE users' },
			);
			expect(result.passed).toBe(false);
			expect(result.failedParam).toBe('query');
			expect(result.failedReason).toContain('blocked value');
		});

		it('fails when a string array contains a blocked value', () => {
			const result = checkParamConstraints(
				{ fields: { notContains: ['ssn', 'creditCard'] } },
				{ fields: ['id', 'email', 'ssn'] },
			);
			expect(result.passed).toBe(false);
			expect(result.failedParam).toBe('fields');
		});
	});

	describe('enum', () => {
		it('passes when value is in allowed enum', () => {
			const result = checkParamConstraints(
				{ format: { enum: ['json', 'csv'] } },
				{ format: 'json' },
			);
			expect(result.passed).toBe(true);
		});

		it('fails when value is not in allowed enum', () => {
			const result = checkParamConstraints(
				{ format: { enum: ['json', 'csv'] } },
				{ format: 'xml' },
			);
			expect(result.passed).toBe(false);
			expect(result.failedReason).toContain('allowed values');
		});
	});

	describe('min/max', () => {
		it('passes when number is within range', () => {
			const result = checkParamConstraints({ count: { min: 1, max: 100 } }, { count: 50 });
			expect(result.passed).toBe(true);
		});

		it('fails when number is below min', () => {
			const result = checkParamConstraints({ count: { min: 1 } }, { count: 0 });
			expect(result.passed).toBe(false);
			expect(result.failedReason).toContain('minimum');
		});

		it('fails when number exceeds max', () => {
			const result = checkParamConstraints({ count: { max: 100 } }, { count: 200 });
			expect(result.passed).toBe(false);
			expect(result.failedReason).toContain('maximum');
		});
	});

	describe('maxLength', () => {
		it('passes when string is within max length', () => {
			const result = checkParamConstraints({ name: { maxLength: 10 } }, { name: 'short' });
			expect(result.passed).toBe(true);
		});

		it('fails when string exceeds max length', () => {
			const result = checkParamConstraints({ name: { maxLength: 5 } }, { name: 'too long string' });
			expect(result.passed).toBe(false);
			expect(result.failedReason).toContain('max length');
		});
	});

	describe('forbidden', () => {
		it('passes when forbidden param is absent', () => {
			const result = checkParamConstraints({ secret: { forbidden: true } }, {});
			expect(result.passed).toBe(true);
		});

		it('fails when forbidden param is present', () => {
			const result = checkParamConstraints({ secret: { forbidden: true } }, { secret: 'value' });
			expect(result.passed).toBe(false);
			expect(result.failedReason).toContain('forbidden');
		});
	});

	describe('startsWith', () => {
		it('passes when string starts with prefix', () => {
			const result = checkParamConstraints(
				{ path: { startsWith: '/home/' } },
				{ path: '/home/user/file.txt' },
			);
			expect(result.passed).toBe(true);
		});

		it('fails when string does not start with prefix', () => {
			const result = checkParamConstraints(
				{ path: { startsWith: '/home/' } },
				{ path: '/etc/passwd' },
			);
			expect(result.passed).toBe(false);
			expect(result.failedReason).toContain('start with');
		});
	});

	describe('notStartsWith', () => {
		it('passes when string does not start with any forbidden prefix', () => {
			const result = checkParamConstraints(
				{ cmd: { notStartsWith: ['rm ', 'sudo '] } },
				{ cmd: 'ls -la' },
			);
			expect(result.passed).toBe(true);
		});

		it('fails when string starts with a forbidden prefix', () => {
			const result = checkParamConstraints(
				{ cmd: { notStartsWith: ['rm ', 'sudo '] } },
				{ cmd: 'rm -rf /' },
			);
			expect(result.passed).toBe(false);
			expect(result.failedReason).toContain('must not start with');
		});
	});

	describe('maxItems', () => {
		it('passes when array is within max items', () => {
			const result = checkParamConstraints({ ids: { maxItems: 5 } }, { ids: [1, 2, 3] });
			expect(result.passed).toBe(true);
		});

		it('fails when array exceeds max items', () => {
			const result = checkParamConstraints({ ids: { maxItems: 2 } }, { ids: [1, 2, 3, 4] });
			expect(result.passed).toBe(false);
			expect(result.failedReason).toContain('max items');
		});
	});

	it('skips constraint check when param is undefined (except forbidden)', () => {
		const result = checkParamConstraints({ missing: { pattern: '^x' } }, {});
		expect(result.passed).toBe(true);
	});
});

describe('checkTimeCondition', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('passes when current day is in allowed days', () => {
		vi.useFakeTimers();
		// 2026-03-18 is Wednesday
		vi.setSystemTime(new Date('2026-03-18T12:00:00'));
		expect(checkTimeCondition({ days: ['wed'] })).toBe(true);
	});

	it('fails when current day is not in allowed days', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-18T12:00:00'));
		expect(checkTimeCondition({ days: ['mon', 'fri'] })).toBe(false);
	});

	it('passes when current time is within hours window', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-18T14:00:00'));
		expect(checkTimeCondition({ hours: { after: '09:00', before: '17:00' } })).toBe(true);
	});

	it('fails when current time is outside hours window', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-18T20:00:00'));
		expect(checkTimeCondition({ hours: { after: '09:00', before: '17:00' } })).toBe(false);
	});

	it('supports full day names and timezone-aware evaluation', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-18T14:00:00Z'));
		expect(
			checkTimeCondition({
				days: ['wednesday'],
				hours: { after: '09:00', before: '17:00' },
				timezone: 'America/New_York',
			}),
		).toBe(true);
	});
});

describe('checkConditions', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('passes when all conditions are met', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-18T14:00:00'));

		const result = checkConditions(
			{
				business_hours: {
					time: {
						days: ['wed'],
						hours: { after: '09:00', before: '17:00' },
					},
				},
			},
			{ id: 'u1', roles: ['user'] },
			{},
		);
		expect(result.passed).toBe(true);
	});

	it('fails when a time condition is not met', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-21T14:00:00')); // Saturday

		const result = checkConditions(
			{
				weekdays_only: {
					time: { days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
				},
			},
			{ id: 'u1', roles: ['user'] },
			{},
		);
		expect(result.passed).toBe(false);
		expect(result.failedCondition).toBe('weekdays_only');
	});

	it('evaluates expression conditions', () => {
		const result = checkConditions(
			{
				is_self: { expression: 'identity.id === "user_1"' },
			},
			{ id: 'user_1', roles: ['user'] },
			{},
		);
		expect(result.passed).toBe(true);
	});

	it('fails when expression evaluates to false', () => {
		const result = checkConditions(
			{
				is_self: { expression: 'identity.id === "other_user"' },
			},
			{ id: 'user_1', roles: ['user'] },
			{},
		);
		expect(result.passed).toBe(false);
		expect(result.failedCondition).toBe('is_self');
	});
});
