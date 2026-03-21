import { describe, it, expect } from 'vitest';
import { ParamGuard, createParamGuard } from './param-guard.js';

describe('ParamGuard', () => {
	describe('pattern', () => {
		it('passes when value matches regex', () => {
			const guard = new ParamGuard().pattern('email', /^.+@.+\..+$/);
			const result = guard.validate({ email: 'test@example.com' });
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('fails when value does not match regex', () => {
			const guard = new ParamGuard().pattern('email', /^.+@.+\..+$/);
			const result = guard.validate({ email: 'not-an-email' });
			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]!.param).toBe('email');
		});

		it('fails when value is not a string', () => {
			const guard = new ParamGuard().pattern('email', /^.+@.+$/);
			const result = guard.validate({ email: 123 });
			expect(result.valid).toBe(false);
		});

		it('uses custom message when provided', () => {
			const guard = new ParamGuard().pattern('id', /^[a-z]+$/, 'ID must be lowercase');
			const result = guard.validate({ id: 'ABC' });
			expect(result.errors[0]!.message).toBe('ID must be lowercase');
		});
	});

	describe('maxLength', () => {
		it('passes when string length is within limit', () => {
			const guard = new ParamGuard().maxLength('name', 10);
			expect(guard.validate({ name: 'short' }).valid).toBe(true);
		});

		it('fails when string exceeds max length', () => {
			const guard = new ParamGuard().maxLength('name', 5);
			const result = guard.validate({ name: 'toolongname' });
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toContain('max length');
		});

		it('fails when value is not a string', () => {
			const guard = new ParamGuard().maxLength('name', 10);
			expect(guard.validate({ name: 12345 }).valid).toBe(false);
		});
	});

	describe('range', () => {
		it('passes when number is within range', () => {
			const guard = new ParamGuard().range('age', 0, 120);
			expect(guard.validate({ age: 25 }).valid).toBe(true);
		});

		it('passes at boundary values', () => {
			const guard = new ParamGuard().range('val', 1, 10);
			expect(guard.validate({ val: 1 }).valid).toBe(true);
			expect(guard.validate({ val: 10 }).valid).toBe(true);
		});

		it('fails when number is below range', () => {
			const guard = new ParamGuard().range('age', 0, 120);
			const result = guard.validate({ age: -1 });
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toContain('between');
		});

		it('fails when number is above range', () => {
			const guard = new ParamGuard().range('age', 0, 120);
			expect(guard.validate({ age: 200 }).valid).toBe(false);
		});

		it('fails when value is not a number', () => {
			const guard = new ParamGuard().range('age', 0, 120);
			expect(guard.validate({ age: 'twenty' }).valid).toBe(false);
		});
	});

	describe('oneOf', () => {
		it('passes when value is in allowed list', () => {
			const guard = new ParamGuard().oneOf('format', ['json', 'csv', 'xml']);
			expect(guard.validate({ format: 'json' }).valid).toBe(true);
		});

		it('fails when value is not in allowed list', () => {
			const guard = new ParamGuard().oneOf('format', ['json', 'csv']);
			const result = guard.validate({ format: 'yaml' });
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toContain('one of');
		});
	});

	describe('required', () => {
		it('passes when parameter is present', () => {
			const guard = new ParamGuard().required('name');
			expect(guard.validate({ name: 'Alice' }).valid).toBe(true);
		});

		it('passes when parameter is falsy but present', () => {
			const guard = new ParamGuard().required('val');
			expect(guard.validate({ val: 0 }).valid).toBe(true);
			expect(guard.validate({ val: '' }).valid).toBe(true);
			expect(guard.validate({ val: false }).valid).toBe(true);
		});

		it('fails when parameter is undefined', () => {
			const guard = new ParamGuard().required('name');
			const result = guard.validate({});
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toContain('required');
		});

		it('fails when parameter is null', () => {
			const guard = new ParamGuard().required('name');
			expect(guard.validate({ name: null }).valid).toBe(false);
		});
	});

	describe('forbidden', () => {
		it('passes when parameter is not present', () => {
			const guard = new ParamGuard().forbidden('secret');
			expect(guard.validate({}).valid).toBe(true);
		});

		it('fails when parameter is present', () => {
			const guard = new ParamGuard().forbidden('secret');
			const result = guard.validate({ secret: 'value' });
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toContain('forbidden');
		});
	});

	describe('notStartsWith', () => {
		it('passes when string does not start with any prefix', () => {
			const guard = new ParamGuard().notStartsWith('cmd', ['rm ', 'sudo ']);
			expect(guard.validate({ cmd: 'ls -la' }).valid).toBe(true);
		});

		it('fails when string starts with a forbidden prefix', () => {
			const guard = new ParamGuard().notStartsWith('cmd', ['rm ', 'sudo ']);
			expect(guard.validate({ cmd: 'rm -rf /' }).valid).toBe(false);
		});
	});

	describe('maxItems', () => {
		it('passes when array length is within limit', () => {
			const guard = new ParamGuard().maxItems('tags', 3);
			expect(guard.validate({ tags: ['a', 'b'] }).valid).toBe(true);
		});

		it('fails when array exceeds max items', () => {
			const guard = new ParamGuard().maxItems('tags', 2);
			expect(guard.validate({ tags: ['a', 'b', 'c'] }).valid).toBe(false);
		});

		it('passes when value is not an array', () => {
			const guard = new ParamGuard().maxItems('tags', 2);
			expect(guard.validate({ tags: 'not-an-array' }).valid).toBe(true);
		});
	});

	describe('custom', () => {
		it('passes when custom check returns true', () => {
			const guard = new ParamGuard().custom(
				'even',
				(v) => typeof v === 'number' && v % 2 === 0,
				'Must be even',
			);
			expect(guard.validate({ even: 4 }).valid).toBe(true);
		});

		it('fails when custom check returns false', () => {
			const guard = new ParamGuard().custom(
				'even',
				(v) => typeof v === 'number' && v % 2 === 0,
				'Must be even',
			);
			const result = guard.validate({ even: 3 });
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toBe('Must be even');
		});
	});

	describe('validate', () => {
		it('returns all errors when multiple rules fail', () => {
			const guard = new ParamGuard()
				.required('name')
				.required('email')
				.range('age', 0, 120);

			const result = guard.validate({ age: -5 });
			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(3);
		});

		it('returns valid: true and empty errors when all pass', () => {
			const guard = new ParamGuard()
				.required('name')
				.maxLength('name', 50);
			const result = guard.validate({ name: 'Alice' });
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
		});
	});

	describe('chaining', () => {
		it('supports fluent chaining', () => {
			const guard = new ParamGuard()
				.required('name')
				.maxLength('name', 50)
				.pattern('email', /^.+@.+$/)
				.range('age', 0, 120)
				.forbidden('password');

			const result = guard.validate({
				name: 'Alice',
				email: 'alice@test.com',
				age: 30,
			});
			expect(result.valid).toBe(true);
		});
	});

	describe('createParamGuard factory', () => {
		it('returns a new ParamGuard instance', () => {
			const guard = createParamGuard();
			expect(guard).toBeInstanceOf(ParamGuard);
		});
	});
});
