import * as fs from 'node:fs';

const DEFAULT_POLICY = `version: "1"

defaults:
  verdict: deny
  audit: true

roles:
  admin:
    description: "Full access to all tools"
    inherits: [user]
  user:
    description: "Standard access with rate limits"
  viewer:
    description: "Read-only tool access"

tools:
  # Add your tool policies here
  # Example:
  # get_weather:
  #   allow:
  #     roles: [user, viewer]
  #   rate_limit:
  #     max_requests: 30
  #     window: 60s
`;

export async function initCommand(): Promise<void> {
	console.log('');
	console.log('  AgentGate Setup');
	console.log('  ===============');
	console.log('');

	const policyPath = './agentgate.policy.yml';

	if (fs.existsSync(policyPath)) {
		console.log(`  Policy file already exists: ${policyPath}`);
		console.log('');
		return;
	}

	fs.writeFileSync(policyPath, DEFAULT_POLICY, 'utf-8');
	console.log(`  Created ${policyPath}`);
	console.log('');
	console.log('  Next steps:');
	console.log('    1. Edit agentgate.policy.yml to define your tool policies');
	console.log('    2. Install an adapter:');
	console.log('       npm install @agentgate/core @agentgate/anthropic');
	console.log('    3. Wrap your tools with gateTool()');
	console.log('    4. Run: agentgate policy validate');
	console.log('');
}
