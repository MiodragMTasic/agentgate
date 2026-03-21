import { PolicyEngine, parsePolicyFromFile, validatePolicy } from '@miodragmtasic/agentgate-core';
import { CapabilityDiscovery } from '@miodragmtasic/agentgate-core';

export async function capabilityCommand(configPath: string, role: string): Promise<void> {
	console.log('');
	console.log(`  Capabilities for role: ${role}`);
	console.log(`  ${'-'.repeat(50)}`);

	const policy = await parsePolicyFromFile(configPath);
	validatePolicy(policy);

	const engine = new PolicyEngine(policy);
	const discovery = new CapabilityDiscovery(engine);

	const identity = { id: `test_${role}`, roles: [role] };
	const capabilities = discovery.discover(identity);

	console.log('');
	console.log('  TOOL                ACCESS    CONSTRAINTS');

	for (const cap of capabilities.tools) {
		const access = cap.allowed ? 'ALLOW' : 'DENY';
		const marker = cap.allowed ? '+' : '-';
		const approval = cap.requiresApproval ? ' (requires approval)' : '';
		const conditions = cap.conditions?.length ? ` [${cap.conditions.join(', ')}]` : '';

		const toolPad = cap.tool.padEnd(20);
		const accessPad = access.padEnd(10);

		console.log(`  ${marker} ${toolPad}${accessPad}${approval}${conditions}`);
	}

	console.log('');
}
