import { existsSync, writeFileSync } from 'node:fs';

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
  get_weather:
    allow:
      - roles: [admin, user, viewer]
    rateLimit:
      maxRequests: 30
      window: 60s

  delete_user:
    allow:
      - roles: [admin]
`;

const DEFAULT_SCENARIOS = `scenarios:
  - name: viewer can get weather
    tool: get_weather
    identity:
      id: viewer_1
      roles: [viewer]
    params:
      location: Toronto
    expected: allow

  - name: user cannot delete a user
    tool: delete_user
    identity:
      id: user_1
      roles: [user]
    params:
      userId: usr_123
    expected: deny
`;

export async function initCommand(): Promise<void> {
	console.log('');
	console.log('  AgentGate Setup');
	console.log('  ===============');
	console.log('');

	const policyPath = './agentgate.policy.yml';
	const scenariosPath = './agentgate.scenarios.yml';
	const created: string[] = [];

	if (!existsSync(policyPath)) {
		writeFileSync(policyPath, DEFAULT_POLICY, 'utf8');
		created.push(policyPath);
	}

	if (!existsSync(scenariosPath)) {
		writeFileSync(scenariosPath, DEFAULT_SCENARIOS, 'utf8');
		created.push(scenariosPath);
	}

	if (created.length === 0) {
		console.log(`  Starter files already exist: ${policyPath}, ${scenariosPath}`);
		console.log('');
		return;
	}

	for (const filePath of created) {
		console.log(`  Created ${filePath}`);
	}

	console.log('');
	console.log('  Next steps:');
	console.log('    1. Edit agentgate.policy.yml to match your tools and roles');
	console.log('    2. Edit agentgate.scenarios.yml to reflect your expected verdicts');
	console.log(
		'    3. Build the local packages or install the packaged artifacts you plan to evaluate',
	);
	console.log('    4. Wire an AgentGate adapter into your tool runtime');
	console.log('    5. Run: agentgate policy validate');
	console.log('    6. Run: agentgate test');
	console.log('');
}
