import type { PolicySet } from './types.js';
import { PolicyParseError, PolicyValidationError } from '../errors.js';

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

export async function parsePolicyFromYaml(yamlStr: string): Promise<PolicySet> {
	try {
		const yaml = await import('yaml');
		const parsed = yaml.parse(yamlStr);
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

export async function parsePolicyFromFile(filePath: string): Promise<PolicySet> {
	try {
		const fs = await import('node:fs/promises');
		const content = await fs.readFile(filePath, 'utf-8');

		if (filePath.endsWith('.json')) {
			return parsePolicyFromObject(JSON.parse(content));
		}

		return parsePolicyFromYaml(content);
	} catch (err) {
		if (err instanceof PolicyParseError || err instanceof PolicyValidationError) {
			throw err;
		}
		throw new PolicyParseError(
			`Failed to read policy file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}
