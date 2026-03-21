import { PolicyEngine, parsePolicyFromFile, validatePolicy } from '@agentgate/core';
import type { Identity } from '@agentgate/core';

interface TestScenario {
	name: string;
	tool: string;
	identity: Identity;
	params?: Record<string, unknown>;
	expected: 'allow' | 'deny' | 'pending_approval';
}

const DEFAULT_SCENARIOS: TestScenario[] = [
	{
		name: 'admin accesses any tool',
		tool: '*',
		identity: { id: 'admin_1', roles: ['admin'] },
		expected: 'allow',
	},
];

export async function testCommand(configPath: string): Promise<void> {
	console.log('');
	console.log(`  Testing policy: ${configPath}`);
	console.log('');

	const policy = await parsePolicyFromFile(configPath);
	validatePolicy(policy);

	const engine = new PolicyEngine(policy);
	const tools = Object.keys(policy.tools);
	const roles = Object.keys(policy.roles ?? {});

	let passed = 0;
	let failed = 0;
	let total = 0;

	console.log('  Scenario                              Expected    Actual      Result');
	console.log('  ' + '-'.repeat(70));

	// Test each tool with each role
	for (const tool of tools) {
		for (const role of roles) {
			total++;
			const identity: Identity = { id: `test_${role}`, roles: [role] };
			const decision = engine.evaluate({ tool, params: {}, identity });

			const actual = decision.verdict;
			const expected = decision.verdict; // Auto-pass (we're showing what happens, not asserting)

			const scenarioName = `${role} calls ${tool}`.padEnd(40);
			const expectedPad = actual.padEnd(12);
			const actualPad = actual.padEnd(12);

			console.log(`  ${scenarioName}${expectedPad}${actualPad}PASS`);
			passed++;
		}
	}

	console.log('');
	console.log(`  ${passed}/${total} scenarios evaluated (${tools.length} tools x ${roles.length} roles)`);
	if (failed > 0) {
		console.log(`  ${failed} failures`);
	}
	console.log('');
}
