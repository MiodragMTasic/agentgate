import { parsePolicyFromFile, validatePolicy } from '@agentgate/core';

export async function validateCommand(configPath: string): Promise<void> {
	console.log('');
	console.log(`  Validating: ${configPath}`);
	console.log('');

	try {
		const policy = await parsePolicyFromFile(configPath);
		validatePolicy(policy);

		const toolCount = Object.keys(policy.tools).length;
		const roleCount = Object.keys(policy.roles ?? {}).length;

		console.log(`  [PASS] Policy is valid`);
		console.log(`         ${toolCount} tool(s), ${roleCount} role(s) defined`);
		console.log(`         Default verdict: ${policy.defaults?.verdict ?? 'deny'}`);
		console.log('');
	} catch (err) {
		if (err instanceof Error && err.name === 'PolicyValidationError') {
			console.error(`  [FAIL] Validation errors:`);
			const errors = (err as { errors?: string[] }).errors ?? [err.message];
			for (const e of errors) {
				console.error(`         - ${e}`);
			}
		} else if (err instanceof Error && err.name === 'PolicyParseError') {
			console.error(`  [FAIL] Parse error: ${err.message}`);
		} else {
			console.error(`  [FAIL] ${err instanceof Error ? err.message : String(err)}`);
		}
		console.log('');
		process.exit(1);
	}
}
