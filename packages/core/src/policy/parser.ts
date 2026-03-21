import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { PolicyParseError, PolicyValidationError } from '../errors.js';

import type { PolicySet } from './types.js';

export function parsePolicyFromObject(obj: unknown): PolicySet {
	if (!obj || typeof obj !== 'object') {
		throw new PolicyParseError('Policy must be an object');
	}

	const raw = obj as Record<string, unknown>;

	if (!raw.version || typeof raw.version !== 'string') {
		throw new PolicyParseError('Policy must have a "version" field');
	}

	if (!raw.tools || typeof raw.tools !== 'object') {
		throw new PolicyParseError('Policy must have a "tools" field');
	}

	return raw as unknown as PolicySet;
}

export function parsePolicyFromYamlSync(yamlStr: string): PolicySet {
	try {
		const parsed = parseYaml(yamlStr);
		return parsePolicyFromObject(parsed);
	} catch (err) {
		if (err instanceof PolicyParseError || err instanceof PolicyValidationError) {
			throw err;
		}
		throw new PolicyParseError(
			`Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export async function parsePolicyFromYaml(yamlStr: string): Promise<PolicySet> {
	return parsePolicyFromYamlSync(yamlStr);
}

export function parsePolicyFromFileSync(filePath: string): PolicySet {
	try {
		const content = readFileSync(filePath, 'utf-8');

		if (filePath.endsWith('.json')) {
			return parsePolicyFromObject(JSON.parse(content));
		}

		return parsePolicyFromYamlSync(content);
	} catch (err) {
		if (err instanceof PolicyParseError || err instanceof PolicyValidationError) {
			throw err;
		}
		throw new PolicyParseError(
			`Failed to read policy file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export async function parsePolicyFromFile(filePath: string): Promise<PolicySet> {
	try {
		const content = await readFile(filePath, 'utf-8');

		if (filePath.endsWith('.json')) {
			return parsePolicyFromObject(JSON.parse(content));
		}

		return parsePolicyFromYamlSync(content);
	} catch (err) {
		if (err instanceof PolicyParseError || err instanceof PolicyValidationError) {
			throw err;
		}
		throw new PolicyParseError(
			`Failed to read policy file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export function parsePolicySourceSync(source: string): PolicySet {
	const trimmed = source.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('version')) {
		return parsePolicyFromYamlSync(source);
	}

	return parsePolicyFromFileSync(source);
}

export async function parsePolicySource(source: string): Promise<PolicySet> {
	const trimmed = source.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('version')) {
		return parsePolicyFromYamlSync(source);
	}

	return parsePolicyFromFile(source);
}
