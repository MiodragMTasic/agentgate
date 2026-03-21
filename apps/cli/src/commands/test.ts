import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { PolicyEngine, parsePolicyFromFile, validatePolicy } from '@miodragmtasic/agentgate-core';
import type { GateVerdict, Identity } from '@miodragmtasic/agentgate-core';

interface TestScenario {
	name: string;
	tool: string;
	identity: Identity;
	params?: Record<string, unknown>;
	expected: GateVerdict;
}

interface ScenarioFile {
	scenarios: TestScenario[];
}

function parseScenarioFile(filePath: string, content: string): ScenarioFile {
	const parsed = filePath.endsWith('.json') ? JSON.parse(content) : parseYaml(content);

	if (Array.isArray(parsed)) {
		return { scenarios: parsed as TestScenario[] };
	}

	if (
		parsed &&
		typeof parsed === 'object' &&
		Array.isArray((parsed as { scenarios?: unknown }).scenarios)
	) {
		return parsed as ScenarioFile;
	}

	throw new Error(
		`Scenario file "${filePath}" must be an array or an object with a "scenarios" array.`,
	);
}

async function loadScenarios(filePath: string): Promise<TestScenario[]> {
	try {
		const content = await readFile(filePath, 'utf8');
		const scenarioFile = parseScenarioFile(filePath, content);
		if (scenarioFile.scenarios.length === 0) {
			throw new Error(`Scenario file "${filePath}" does not define any scenarios.`);
		}

		return scenarioFile.scenarios;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(
				`No scenarios file found at ${filePath}. Create one with \`agentgate init\` or pass --scenarios <path>.`,
			);
		}

		throw error;
	}
}

function validateScenario(scenario: TestScenario, index: number): void {
	if (!scenario.name) {
		throw new Error(`Scenario ${index + 1} is missing "name".`);
	}
	if (!scenario.tool) {
		throw new Error(`Scenario "${scenario.name}" is missing "tool".`);
	}
	if (!scenario.identity?.id || !Array.isArray(scenario.identity.roles)) {
		throw new Error(`Scenario "${scenario.name}" must define identity.id and identity.roles.`);
	}
	if (!['allow', 'deny', 'pending_approval'].includes(scenario.expected)) {
		throw new Error(
			`Scenario "${scenario.name}" has invalid expected verdict "${scenario.expected}".`,
		);
	}
}

export async function testCommand(configPath: string, scenariosPath: string): Promise<void> {
	console.log('');
	console.log(`  Testing policy: ${configPath}`);
	console.log(`  Scenarios:      ${scenariosPath}`);
	console.log('');

	const policy = await parsePolicyFromFile(configPath);
	validatePolicy(policy);

	const scenarios = await loadScenarios(scenariosPath);
	scenarios.forEach(validateScenario);

	const engine = new PolicyEngine(policy);

	let passed = 0;
	let failed = 0;

	console.log('  Scenario                              Expected          Actual            Result');
	console.log(`  ${'-'.repeat(84)}`);

	for (const scenario of scenarios) {
		const decision = engine.evaluate({
			tool: scenario.tool,
			params: scenario.params ?? {},
			identity: scenario.identity,
		});

		const actual = decision.verdict;
		const expected = scenario.expected;
		const success = actual === expected;

		const scenarioName = scenario.name.padEnd(38);
		const expectedPad = expected.padEnd(18);
		const actualPad = actual.padEnd(18);
		const result = success ? 'PASS' : 'FAIL';

		console.log(`  ${scenarioName}${expectedPad}${actualPad}${result}`);
		if (!success) {
			console.log(`    Reason: ${decision.reason}`);
		}

		if (success) {
			passed++;
		} else {
			failed++;
		}
	}

	console.log('');
	console.log(`  ${passed}/${scenarios.length} scenarios passed`);
	console.log('');

	if (failed > 0) {
		throw new Error(`${failed} scenario(s) failed.`);
	}
}
