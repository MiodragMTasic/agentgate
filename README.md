# AgentGate

**Permission middleware for AI agents. TypeScript-native. Works everywhere.**

[![npm version](https://img.shields.io/npm/v/@agentgate/core.svg)](https://www.npmjs.com/package/@agentgate/core)
[![CI](https://github.com/miodrag/agentgate/actions/workflows/ci.yml/badge.svg)](https://github.com/miodrag/agentgate/actions/workflows/ci.yml)
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

## Quick Start

```bash
npm install @agentgate/core @agentgate/anthropic
```

```typescript
import { AgentGate, consoleSink } from '@agentgate/core';
import { gateTool } from '@agentgate/anthropic';

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
import { gateTool, createGateToolRunner } from '@agentgate/anthropic';

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
import { gateTool } from '@agentgate/openai';

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
import { GateMcpServer } from '@agentgate/mcp';

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

```
$ npx agentgate init              # Scaffold policy file
$ npx agentgate policy validate   # Validate policy syntax
$ npx agentgate test              # Dry-run against test scenarios
$ npx agentgate capability --role agent
$ npx agentgate audit             # View decision log
```

```
  agentgate watch
  ┌──────────────────────────────────────────────┐
  │  AgentGate v0.1.0        uptime: 2h 14m      │
  │                                               │
  │  Decisions    1,247 total   3.2/s             │
  │  Allowed      1,180 (94.6%)                   │
  │  Denied          52 (4.2%)                    │
  │  Pending         15 (1.2%)                    │
  │                                               │
  │  Top denied tools:                            │
  │    send_email       28  (rate limit)          │
  │    delete_user      14  (role)                │
  │    read_file        10  (param)               │
  │                                               │
  │  Budget: $12.40 / $50.00 daily                │
  └──────────────────────────────────────────────┘
```

## Packages

| Package | Description |
| --- | --- |
| [`@agentgate/core`](./packages/core) | Policy engine, guards, rate limiter, budget, audit, HITL |
| [`@agentgate/anthropic`](./packages/anthropic) | Adapter for the Anthropic SDK |
| [`@agentgate/openai`](./packages/openai) | Adapter for the OpenAI SDK |
| [`@agentgate/mcp`](./packages/mcp) | Adapter for Model Context Protocol |
| [`@agentgate/cli`](./apps/cli) | CLI for policy validation, testing, and monitoring |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## Security

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
