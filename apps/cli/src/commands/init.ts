import { existsSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

type RuntimeChoice = 'generic' | 'claude-code' | 'codex' | 'mcp' | 'anthropic' | 'openai';

interface InitOptions {
	runtime?: string;
	projectName?: string;
}

interface StarterBundle {
	runtime: RuntimeChoice;
	label: string;
	policy: string;
	scenarios: string;
	onboarding: string;
}

const GENERIC_POLICY = `version: "1"

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

const GENERIC_SCENARIOS = `scenarios:
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

function normalizeRuntime(value?: string): RuntimeChoice {
	switch ((value ?? 'generic').trim().toLowerCase()) {
		case 'claude':
		case 'claude-code':
			return 'claude-code';
		case 'codex':
			return 'codex';
		case 'mcp':
			return 'mcp';
		case 'anthropic':
			return 'anthropic';
		case 'openai':
			return 'openai';
		default:
			return 'generic';
	}
}

function detectProjectName(projectName?: string): string {
	const fallback = basename(process.cwd()) || 'your-project';
	return (projectName ?? fallback).trim() || fallback;
}

function buildCodingAgentBundle(
	runtime: 'claude-code' | 'codex' | 'mcp',
	projectName: string,
): StarterBundle {
	const runtimeLabel =
		runtime === 'claude-code' ? 'Claude Code' : runtime === 'codex' ? 'Codex' : 'MCP';

	const policy = `version: "1"

defaults:
  verdict: deny
  audit: true

roles:
  agent:
    description: "AI coding agent for ${projectName}"
  maintainer:
    description: "Human reviewer or privileged automation"
    inherits: [agent]

tools:
  read_file:
    deny:
      - params:
          path:
            contains: [".env", "/secrets/", "firebase-adminsdk"]
    allow:
      - roles: [agent, maintainer]

  run_command:
    deny:
      - params:
          command:
            contains: ["rm -rf", "git push --force", "terraform destroy", "vercel --prod", "firebase deploy --only"]
    allow:
      - roles: [agent, maintainer]
        params:
          command:
            contains: ["pnpm test", "pnpm lint", "pnpm build", "pnpm typecheck", "git status"]
    rateLimit:
      maxRequests: 20
      window: 1h

  deploy_preview:
    allow:
      - roles: [maintainer]
    requireApproval:
      when:
        roles: [maintainer]
`;

	const scenarios = `scenarios:
  - name: agent can read a safe source file
    tool: read_file
    identity:
      id: agent_1
      roles: [agent]
    params:
      path: /workspace/src/App.tsx
    expected: allow

  - name: agent cannot read secrets
    tool: read_file
    identity:
      id: agent_1
      roles: [agent]
    params:
      path: /workspace/.env
    expected: deny

  - name: agent can run a safe command
    tool: run_command
    identity:
      id: agent_1
      roles: [agent]
    params:
      command: pnpm test
      workdir: /workspace
    expected: allow

  - name: agent cannot run a destructive command
    tool: run_command
    identity:
      id: agent_1
      roles: [agent]
    params:
      command: rm -rf /
      workdir: /workspace
    expected: deny

  - name: maintainer preview deploy requires approval
    tool: deploy_preview
    identity:
      id: maintainer_1
      roles: [maintainer]
    params:
      target: preview
    expected: pending_approval
`;

	const onboarding = `# AgentGate Onboarding

## What This Is

AgentGate is the policy layer in front of your ${runtimeLabel} tools.

It does not replace ${runtimeLabel}. It decides whether ${runtimeLabel} is allowed to use a tool, with which arguments, how often, and whether a human needs to approve it first.

## Best Fit For This Runtime

For ${runtimeLabel}, the cleanest integration is usually:

1. expose your risky project actions as MCP tools
2. put AgentGate in front of those tools
3. let ${runtimeLabel} call the guarded MCP server instead of raw tools

## First 15 Minutes

1. Rename the starter tools in \`agentgate.policy.yml\` to match your real tools.
2. Start with just three categories:
   - safe reads
   - safe commands
   - anything risky that should require approval
3. Validate the policy:

\`\`\`bash
pnpm exec agentgate policy validate
\`\`\`

4. Run the dry-run scenarios:

\`\`\`bash
pnpm exec agentgate test
\`\`\`

5. Put AgentGate in front of your MCP tools.

## Minimal MCP Wiring

\`\`\`ts
import { AgentGate } from '@miodragmtasic/agentgate-core';
import { GateMcpServer } from '@miodragmtasic/agentgate-mcp';

const gate = new AgentGate({
  policies: './agentgate.policy.yml',
});

const server = new GateMcpServer(
  { name: '${projectName}-tools', version: '0.1.0' },
  gate,
  (ctx) => ({ id: ctx.sessionId ?? 'anon', roles: ['agent'] }),
);

server.registerTool('read_file', {
  description: 'Read a workspace file',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
}, async (args) => {
  return { content: [{ type: 'text', text: '...' }] };
});
\`\`\`

## How To Think About Tool Selection

Good starter tools for ${projectName}:

- read docs, source, and safe config
- run \`pnpm test\`, \`pnpm lint\`, \`pnpm build\`
- query read-only public data

Tools that usually belong behind approval:

- production deploys
- user-facing email
- writes to Stripe, Firebase Admin, or production databases
- anything that could leak secrets or damage user data

## What Success Looks Like

When this is wired correctly, ${runtimeLabel} still feels normal to use, but:

- safe actions keep flowing
- secret reads get blocked
- destructive commands get blocked
- risky actions pause for human approval

That is the whole product.
`;

	return {
		runtime,
		label: runtimeLabel,
		policy,
		scenarios,
		onboarding,
	};
}

function buildSdkBundle(runtime: 'anthropic' | 'openai', projectName: string): StarterBundle {
	const runtimeLabel = runtime === 'anthropic' ? 'Anthropic SDK' : 'OpenAI SDK';
	const adapterPackage =
		runtime === 'anthropic'
			? '@miodragmtasic/agentgate-anthropic'
			: '@miodragmtasic/agentgate-openai';

	const policy = `version: "1"

defaults:
  verdict: deny
  audit: true

roles:
  agent:
    description: "Application agent for ${projectName}"
  reviewer:
    description: "Human or service account with elevated permissions"
    inherits: [agent]

tools:
  search_knowledge_base:
    allow:
      - roles: [agent, reviewer]

  send_email:
    deny:
      - params:
          to:
            contains: ["@competitor.com"]
    allow:
      - roles: [agent, reviewer]
        params:
          to:
            notContains: ["@competitor.com"]

  issue_refund:
    allow:
      - roles: [agent, reviewer]
    requireApproval:
      when:
        roles: [agent, reviewer]
        params:
          amount:
            min: 100
`;

	const scenarios = `scenarios:
  - name: agent can search the knowledge base
    tool: search_knowledge_base
    identity:
      id: agent_1
      roles: [agent]
    params:
      query: delayed order refund policy
    expected: allow

  - name: agent cannot email a competitor
    tool: send_email
    identity:
      id: agent_1
      roles: [agent]
    params:
      to: ops@competitor.com
      subject: Hello
      body: This should be denied
    expected: deny

  - name: high-value refund requires approval
    tool: issue_refund
    identity:
      id: agent_1
      roles: [agent]
    params:
      orderId: ORD-101
      amount: 250
      reason: damaged order
    expected: pending_approval
`;

	const wiringSnippet =
		runtime === 'anthropic'
			? `import { createGateToolRunner, gateTool } from '${adapterPackage}';

const guardedTool = gateTool(gate, {
  name: 'send_email',
  description: 'Send a user email',
  inputSchema: {
    type: 'object',
    properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
    required: ['to', 'subject', 'body'],
  },
  identity: { id: 'agent_1', roles: ['agent'] },
  run: async (input) => JSON.stringify({ sent: true, to: input.to }),
});

const runner = createGateToolRunner(gate, { id: 'agent_1', roles: ['agent'] });`
			: `import { gateTool, gateToolExecutors } from '${adapterPackage}';

const guardedTool = gateTool(gate, {
  definition: {
    type: 'function',
    function: {
      name: 'send_email',
      parameters: {
        type: 'object',
        properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  identity: { id: 'agent_1', roles: ['agent'] },
  execute: async (args) => ({ sent: true, to: args.to }),
});

const executors = gateToolExecutors(gate, {
  send_email: async (args) => ({ sent: true, to: args.to }),
}, { id: 'agent_1', roles: ['agent'] });`;

	const onboarding = `# AgentGate Onboarding

## What This Is

AgentGate is the policy layer in front of your ${runtimeLabel} tools.

Your model can still choose tools. AgentGate decides whether a specific tool call is allowed, denied, or should pause for approval.

## Best Fit For This Runtime

For ${runtimeLabel}, the normal integration is direct wrapping:

1. create an \`AgentGate\`
2. load \`agentgate.policy.yml\`
3. wrap each tool definition with the AgentGate adapter

## First 15 Minutes

1. Rename the starter tools to the tools your app already has.
2. Keep the first version small:
   - one clearly safe read tool
   - one clearly risky write tool
   - one approval-gated tool
3. Validate the policy:

\`\`\`bash
pnpm exec agentgate policy validate
\`\`\`

4. Run the dry-run scenarios:

\`\`\`bash
pnpm exec agentgate test
\`\`\`

5. Wrap the tools in code.

## Minimal Wiring

\`\`\`ts
import { AgentGate } from '@miodragmtasic/agentgate-core';
${wiringSnippet}
\`\`\`

## What To Protect First In ${projectName}

Start with anything that would be embarrassing or costly if the model got it wrong:

- outbound email
- database writes
- refunds or credits
- deploys
- anything that exposes secrets or private user data

The safe rule of thumb is:

- read-only search tools are good first candidates
- money movement, user-facing messaging, and prod writes should start denied or approval-gated
`;

	return {
		runtime,
		label: runtimeLabel,
		policy,
		scenarios,
		onboarding,
	};
}

function buildGenericBundle(projectName: string): StarterBundle {
	const onboarding = `# AgentGate Onboarding

## What This Is

AgentGate is the policy layer in front of your agent tools.

It answers one question before every tool call:

> should this agent be allowed to do this exact action right now?

## Choose Your Path

### If you use Claude Code or Codex

Use AgentGate in front of MCP tools.

That usually means:

1. expose risky project actions as MCP tools
2. put AgentGate in front of those MCP tools
3. let Claude Code or Codex call the guarded server

Recommended starter:

\`\`\`bash
pnpm exec agentgate init --runtime claude-code
\`\`\`

or

\`\`\`bash
pnpm exec agentgate init --runtime codex
\`\`\`

### If you use the Anthropic or OpenAI SDK directly

Wrap tool definitions with the runtime adapter.

Recommended starters:

\`\`\`bash
pnpm exec agentgate init --runtime anthropic
pnpm exec agentgate init --runtime openai
\`\`\`

## First 10 Minutes In ${projectName}

1. Replace the sample tools in \`agentgate.policy.yml\` with real tool names.
2. Replace the scenarios with the actions you most care about.
3. Run:

\`\`\`bash
pnpm exec agentgate policy validate
pnpm exec agentgate test
\`\`\`

4. Only after the policy behaves correctly should you wire the adapter into your runtime.

## The Product In One Sentence

Claude Code, Codex, OpenAI, Anthropic, or MCP still choose tools.
AgentGate decides whether those tool calls are allowed.
`;

	return {
		runtime: 'generic',
		label: 'Generic',
		policy: GENERIC_POLICY,
		scenarios: GENERIC_SCENARIOS,
		onboarding,
	};
}

function buildStarterBundle(runtime: RuntimeChoice, projectName: string): StarterBundle {
	switch (runtime) {
		case 'claude-code':
		case 'codex':
		case 'mcp':
			return buildCodingAgentBundle(runtime, projectName);
		case 'anthropic':
		case 'openai':
			return buildSdkBundle(runtime, projectName);
		default:
			return buildGenericBundle(projectName);
	}
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
	console.log('');
	console.log('  AgentGate Setup');
	console.log('  ===============');
	console.log('');

	const runtime = normalizeRuntime(options.runtime);
	const projectName = detectProjectName(options.projectName);
	const bundle = buildStarterBundle(runtime, projectName);

	const policyPath = './agentgate.policy.yml';
	const scenariosPath = './agentgate.scenarios.yml';
	const onboardingPath = './agentgate.onboarding.md';
	const created: string[] = [];

	if (!existsSync(policyPath)) {
		writeFileSync(policyPath, bundle.policy, 'utf8');
		created.push(policyPath);
	}

	if (!existsSync(scenariosPath)) {
		writeFileSync(scenariosPath, bundle.scenarios, 'utf8');
		created.push(scenariosPath);
	}

	if (!existsSync(onboardingPath)) {
		writeFileSync(onboardingPath, bundle.onboarding, 'utf8');
		created.push(onboardingPath);
	}

	console.log(`  Runtime profile: ${bundle.label}`);
	console.log(`  Project:         ${projectName}`);
	console.log('');

	if (created.length === 0) {
		console.log(
			`  Starter files already exist: ${policyPath}, ${scenariosPath}, ${onboardingPath}`,
		);
		console.log('');
		return;
	}

	for (const filePath of created) {
		console.log(`  Created ${filePath}`);
	}

	console.log('');
	console.log('  Next steps:');
	console.log('    1. Read agentgate.onboarding.md');
	console.log('    2. Rename the starter tools to match your real tools');
	console.log('    3. Run: agentgate policy validate');
	console.log('    4. Run: agentgate test');
	console.log('    5. Wire AgentGate into your runtime');
	console.log('');
}
