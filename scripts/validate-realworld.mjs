import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'agentgate-realworld-'));
const packDir = join(tempRoot, 'packs');
const consumerDir = join(tempRoot, 'consumer');

const publicPackages = [
	{ path: 'packages/core', name: '@miodragmtasic/agentgate-core' },
	{
		path: 'packages/anthropic',
		name: '@miodragmtasic/agentgate-anthropic',
	},
	{ path: 'packages/openai', name: '@miodragmtasic/agentgate-openai' },
	{ path: 'packages/mcp', name: '@miodragmtasic/agentgate-mcp' },
	{ path: 'apps/cli', name: '@miodragmtasic/agentgate-cli' },
];

function run(command, args, cwd, options = {}) {
	console.log(`\n$ ${command} ${args.join(' ')}`);
	return execFileSync(command, args, {
		cwd,
		stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		encoding: 'utf8',
	});
}

try {
	mkdirSync(packDir, { recursive: true });

	for (const pkg of publicPackages) {
		run('pnpm', ['build'], resolve(rootDir, pkg.path));
		const packOutput = run(
			'pnpm',
			['pack', '--pack-destination', packDir, '--json'],
			resolve(rootDir, pkg.path),
			{ capture: true },
		);
		const parsedPackOutput = JSON.parse(packOutput);
		const packResult = Array.isArray(parsedPackOutput) ? parsedPackOutput[0] : parsedPackOutput;
		pkg.tarball = packResult.filename;
	}

	const tarballFor = (packageName) => {
		const pkg = publicPackages.find((candidate) => candidate.name === packageName);
		if (!pkg?.tarball) {
			throw new Error(`Missing tarball for ${packageName}`);
		}
		return `file:${pkg.tarball}`;
	};

	mkdirSync(consumerDir, { recursive: true });
	writeFileSync(
		join(consumerDir, 'package.json'),
		JSON.stringify(
			{
				name: 'agentgate-realworld-consumer',
				private: true,
				type: 'module',
				dependencies: {
					'@miodragmtasic/agentgate-core': tarballFor('@miodragmtasic/agentgate-core'),
					'@miodragmtasic/agentgate-anthropic': tarballFor('@miodragmtasic/agentgate-anthropic'),
					'@miodragmtasic/agentgate-openai': tarballFor('@miodragmtasic/agentgate-openai'),
					'@miodragmtasic/agentgate-mcp': tarballFor('@miodragmtasic/agentgate-mcp'),
					'@miodragmtasic/agentgate-cli': tarballFor('@miodragmtasic/agentgate-cli'),
					'@anthropic-ai/sdk': '^0.39.0',
					'@modelcontextprotocol/sdk': '^1.27.1',
					openai: '^4.104.0',
					zod: '^3.25.0',
				},
				pnpm: {
					overrides: {
						'@miodragmtasic/agentgate-core': tarballFor('@miodragmtasic/agentgate-core'),
					},
				},
			},
			null,
			2,
		),
	);

	run('pnpm', ['install'], consumerDir);
	run('pnpm', ['exec', 'agentgate', 'init'], consumerDir);
	run('pnpm', ['exec', 'agentgate', 'policy', 'validate'], consumerDir);
	run('pnpm', ['exec', 'agentgate', 'test'], consumerDir);
	run('pnpm', ['exec', 'agentgate', 'capability', '--role', 'viewer'], consumerDir);

	writeFileSync(
		join(consumerDir, 'smoke.mjs'),
		`import assert from 'node:assert/strict';
import { AgentGate } from '@miodragmtasic/agentgate-core';
import { gateTool as anthropicGateTool } from '@miodragmtasic/agentgate-anthropic';
import { gateTool as openAIGateTool, gateRunToolsParams } from '@miodragmtasic/agentgate-openai';
import { GateMcpServer } from '@miodragmtasic/agentgate-mcp';

const gate = new AgentGate({ policies: './agentgate.policy.yml' });
const identity = { id: 'viewer_1', roles: ['viewer'] };

const coreDecision = await gate.evaluate({
  tool: 'get_weather',
  params: { location: 'Toronto' },
  identity,
});
assert.equal(coreDecision.verdict, 'allow');

const anthropicTool = anthropicGateTool(gate, {
  name: 'get_weather',
  description: 'Get the weather',
  inputSchema: { type: 'object', properties: { location: { type: 'string' } } },
  identity,
  run: async (input) => \`Weather for \${input.location}\`,
});
assert.equal(await anthropicTool.run({ location: 'Toronto' }), 'Weather for Toronto');

const openAITool = openAIGateTool(gate, {
  definition: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the weather',
      parameters: { type: 'object', properties: { location: { type: 'string' } } },
    },
  },
  execute: async (args) => ({ ok: true, location: args.location }),
  identity,
});
assert.deepEqual(await openAITool.execute({ location: 'Toronto' }), { ok: true, location: 'Toronto' });

const runnerParams = gateRunToolsParams(gate, identity, {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: { type: 'object', properties: { location: { type: 'string' } } },
        function: async (args) => ({ ok: true, location: args.location }),
      },
    },
  ],
});
assert.deepEqual(await runnerParams.tools[0].function.function({ location: 'Toronto' }), { ok: true, location: 'Toronto' });

const server = new GateMcpServer(
  { name: 'weather-server', version: '1.0.0' },
  gate,
  () => identity,
);
server.registerTool(
  'get_weather',
  {
    title: 'Get Weather',
    description: 'Get the weather',
    inputSchema: { type: 'object', properties: { location: { type: 'string' } } },
  },
  async (args) => ({ content: [{ type: 'text', text: \`Weather for \${args.location}\` }] }),
);
const mcpResult = await server.callTool('get_weather', { location: 'Toronto' });
assert.equal(mcpResult.isError, undefined);
assert.equal(mcpResult.content[0].text, 'Weather for Toronto');

await gate.shutdown();
console.log('realworld smoke ok');
`,
	);

	run('node', ['smoke.mjs'], consumerDir);
	const auditLogOutput = run('pnpm', ['exec', 'agentgate', 'audit'], consumerDir, {
		capture: true,
	});
	if (!auditLogOutput.includes('No audit log found')) {
		console.log(auditLogOutput);
	}

	console.log('\nReal-world validation passed.');
	console.log(`Artifacts kept in ${tempRoot}`);
} catch (error) {
	console.error('\nReal-world validation failed.');
	if (error instanceof Error) {
		console.error(error.message);
	}
	throw error;
}
