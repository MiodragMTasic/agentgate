import { describe, expect, it } from 'vitest';
import { PolicyParseError } from '../errors.js';
import { parsePolicyFromObject, parsePolicyFromYaml } from './parser.js';

describe('parsePolicyFromObject', () => {
	it('parses a valid policy object', () => {
		const obj = {
			version: '1',
			tools: {
				read_file: { allow: { roles: ['user'] } },
			},
		};
		const result = parsePolicyFromObject(obj);
		expect(result.version).toBe('1');
		expect(result.tools.read_file).toBeDefined();
	});

	it('throws PolicyParseError when input is null', () => {
		expect(() => parsePolicyFromObject(null)).toThrow(PolicyParseError);
		expect(() => parsePolicyFromObject(null)).toThrow('Policy must be an object');
	});

	it('throws PolicyParseError when input is not an object', () => {
		expect(() => parsePolicyFromObject('string')).toThrow(PolicyParseError);
		expect(() => parsePolicyFromObject(42)).toThrow(PolicyParseError);
	});

	it('throws PolicyParseError when version is missing', () => {
		expect(() => parsePolicyFromObject({ tools: {} })).toThrow('must have a "version"');
	});

	it('throws PolicyParseError when version is not a string', () => {
		expect(() => parsePolicyFromObject({ version: 1, tools: {} })).toThrow('must have a "version"');
	});

	it('throws PolicyParseError when tools is missing', () => {
		expect(() => parsePolicyFromObject({ version: '1' })).toThrow('must have a "tools"');
	});

	it('throws PolicyParseError when tools is not an object', () => {
		expect(() => parsePolicyFromObject({ version: '1', tools: 'bad' })).toThrow(
			'must have a "tools"',
		);
	});

	it('preserves optional fields like roles and defaults', () => {
		const obj = {
			version: '1',
			defaults: { verdict: 'deny' },
			roles: { admin: { inherits: ['user'] } },
			tools: {},
		};
		const result = parsePolicyFromObject(obj);
		expect(result.defaults?.verdict).toBe('deny');
		expect(result.roles?.admin?.inherits).toEqual(['user']);
	});
});

describe('parsePolicyFromYaml', () => {
	it('parses valid YAML policy', async () => {
		const yaml = `
version: "1"
tools:
  read_file:
    allow:
      roles:
        - user
`;
		const result = await parsePolicyFromYaml(yaml);
		expect(result.version).toBe('1');
		expect(result.tools.read_file).toBeDefined();
	});

	it('throws PolicyParseError on invalid YAML', async () => {
		const badYaml = '{ invalid yaml [[[';
		await expect(parsePolicyFromYaml(badYaml)).rejects.toThrow(PolicyParseError);
	});

	it('throws PolicyParseError when YAML parses to non-object', async () => {
		const yamlStr = '"just a string"';
		await expect(parsePolicyFromYaml(yamlStr)).rejects.toThrow(PolicyParseError);
	});

	it('throws PolicyParseError when YAML is missing required fields', async () => {
		const yaml = `
tools:
  read_file:
    allow: {}
`;
		await expect(parsePolicyFromYaml(yaml)).rejects.toThrow('must have a "version"');
	});
});
