# AgentGate

**Permission middleware for AI agents. TypeScript-native. Works everywhere.**

[![CI](https://github.com/MiodragMTasic/agentgate/actions/workflows/ci.yml/badge.svg)](https://github.com/MiodragMTasic/agentgate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)

---

## Why AgentGate?

Every AI agent framework lets agents call tools. None of them ask **"should this agent be allowed to?"**

AgentGate is a permission layer that sits between your agent and its tools. Define who can call what, with what parameters, how often, and at what cost -- in a single YAML file.

| Feature | AgentGate | OPA | Permit.io | Arcade.dev | Oso |
| --- | :---: | :---: | :---: | :---: | :---: |
| TypeScript-native | Yes | No | No | No | No |
| Simple YAML DSL | Yes | Rego | No | No | Polar |
| Works offline | Yes | Yes | No | No | Yes |
| Agent-specific primitives | Yes | No | No | Partial | No |
| HITL approval flows | Yes | No | No | No | No |
| Budget tracking | Yes | No | No | No | No |
| MCP support | Yes | No | No | No | No |
| Fully open source | Yes | Yes | Partial | No | Partial |

## Current Status

- The codebase is validated locally and through packed consumer smoke tests.
- The publish target is the `@miodragmtasic/agentgate-*` package family.
- The repo is release-prepared, but the packages are not published yet. Treat this as a source checkout until the first npm release actually lands.

## Local Quick Start

```bash
pnpm install
pnpm build
node ./apps/cli/dist/agentgate.js init
node ./apps/cli/dist/agentgate.js policy validate
node ./apps/cli/dist/agentgate.js test
```

```typescript
import { AgentGate, consoleSink } from '@miodragmtasic/agentgate-core';
import { gateTool } from '@miodragmtasic/agentgate-anthropic';

const gate = new AgentGate({
  policies: './agentgate.policy.yml',
  audit: { sinks: [consoleSink()] },
});

const tool = gateTool(gate, {
  name: 'send_email',
  description: 'Send an email',
  inputSchema: { type: 'object', properties: { to: { type: 'string' } } },
  identity: { id: 'agent_01', roles: ['agent'] },
  run: async (input) => JSON.stringify({ sent: true, to: input.to }),
});

// AgentGate evaluates policy before every tool call
const result = await tool.run({ to: 'alice@mycompany.com' }); // allowed
const denied = await tool.run({ to: 'info@competitor.com' }); // denied by policy
```

## Validated Surfaces

- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build`, `pnpm test`, and `pnpm typecheck` pass locally.
- Packed `@miodragmtasic/agentgate-core`, `@miodragmtasic/agentgate-anthropic`, `@miodragmtasic/agentgate-openai`, `@miodragmtasic/agentgate-mcp`, and `@miodragmtasic/agentgate-cli` tarballs install into a fresh outside-the-monorepo consumer project.
- The packaged CLI is exercised end-to-end through `init`, `policy validate`, `test`, and `capability`.
- The core package is exercised from a packed consumer using YAML policies loaded from disk.
- Adapter boundaries are contract-tested against Anthropic/OpenAI/MCP SDK request shapes used by this repo.
- You can rerun the packaged smoke validation with:

```bash
pnpm validate:realworld
```

## Not Yet Proven

- Live Anthropic or OpenAI API calls against a real remote account
- MCP interoperability against a remote third-party server over a real transport
- Production persistence/load behavior beyond the in-memory stores included here
- External adoption or traction claims

## Release Guardrails

- Run `pnpm release:check` before any publish attempt.
- That check verifies the configured package names are still available or already owned by this repo lineage before you publish.

## Features

### Policy Engine

YAML-based policies with role inheritance, parameter constraints, and time-based conditions. Deny-by-default. Hot-reload without restarts.

### Rate Limiting

Sliding window and token bucket strategies. Scope limits per identity, per tool, or globally.

### Budget Tracking

Assign costs to tool calls. Set hourly, daily, or monthly budgets per user or organization. Prevent runaway spending.

### Human-in-the-Loop

Route sensitive tool calls to human approvers via console prompts or webhooks. Configurable timeouts with deny-on-timeout.

### Audit Logging

Every decision is logged with identity, tool, params, verdict, and timing. Ship to console, file, or webhook sinks.

### Capability Discovery

Ask AgentGate what a given identity is allowed to do. Useful for dynamically filtering the tool set you expose to an agent.

```typescript
const capabilities = gate.discover({ id: 'agent_01', roles: ['agent'] });
// { tools: ['get_weather', 'send_email'], denied: ['read_file', 'delete_user'] }
```

## Framework Adapters

### Anthropic

```typescript
import { gateTool, createGateToolRunner } from '@miodragmtasic/agentgate-anthropic';

// Option 1: Wrap individual tools
const tool = gateTool(gate, { name: 'get_weather', identity: user, run, ... });

// Option 2: Wrap an entire tool runner
const runner = createGateToolRunner(gate, user);
const response = await client.beta.messages.runTools({
  model: 'claude-sonnet-4-5-20250929',
  ...runner.wrapParams({ tools, messages }),
});
```

### OpenAI

```typescript
import { gateTool } from '@miodragmtasic/agentgate-openai';

const tool = gateTool(gate, {
  definition: {
    type: 'function',
    function: { name: 'get_weather', parameters: { ... } },
  },
  execute: async (args) => ({ temp: 72 }),
  identity: user,
});
```

### MCP

```typescript
import { GateMcpServer } from '@miodragmtasic/agentgate-mcp';

const server = new GateMcpServer(
  { name: 'my-server', version: '1.0.0' },
  gate,
  (ctx) => ({ id: ctx.sessionId ?? 'anon', roles: ['user'] }),
);

server.registerTool('get_weather', {
  description: 'Get weather',
  inputSchema: { type: 'object', properties: { location: { type: 'string' } } },
}, async (args) => ({
  content: [{ type: 'text', text: `Weather: sunny` }],
}));
```

## Policy DSL

Policies are defined in YAML. One file controls everything.

```yaml
version: "1"

defaults:
  verdict: deny
  audit: true

roles:
  user:
    description: Standard user
  agent:
    inherits: [user]
  admin:
    inherits: [agent]

tools:
  get_weather:
    allow:
      - roles: [user, agent, admin]
    rateLimit:
      maxRequests: 30
      window: 1m

  send_email:
    allow:
      - roles: [agent, admin]
        params:
          to:
            pattern: "^[^@]+@mycompany\\.com$"
    deny:
      - params:
          to:
            contains: ["@competitor.com"]
    rateLimit:
      maxRequests: 10
      window: 1h
    cost: 0.01
    budget:
      perUser:
        daily: 5.00

  delete_user:
    allow:
      - roles: [admin]
    requireApproval:
      approvers: [admin]
      timeout: 5m
      timeoutAction: deny
```

## CLI

```bash
node ./apps/cli/dist/agentgate.js init
node ./apps/cli/dist/agentgate.js policy validate
node ./apps/cli/dist/agentgate.js test --scenarios ./agentgate.scenarios.yml
node ./apps/cli/dist/agentgate.js capability --role agent
node ./apps/cli/dist/agentgate.js audit
```

When the CLI is installed into a consumer project, the equivalent commands are `pnpm exec agentgate ...`.

## Packages

| Package | Description |
| --- | --- |
| [`@miodragmtasic/agentgate-core`](./packages/core) | Policy engine, guards, rate limiter, budget, audit, HITL |
| [`@miodragmtasic/agentgate-anthropic`](./packages/anthropic) | Adapter for the Anthropic SDK |
| [`@miodragmtasic/agentgate-openai`](./packages/openai) | Adapter for the OpenAI SDK |
| [`@miodragmtasic/agentgate-mcp`](./packages/mcp) | Adapter for Model Context Protocol |
| [`@miodragmtasic/agentgate-cli`](./apps/cli) | CLI for policy validation, scenario testing, and audit inspection |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## Security

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
