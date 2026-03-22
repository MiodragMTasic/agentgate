# AgentGate

**Permission middleware for AI agents. TypeScript-native. Works everywhere.**

[![CI](https://github.com/MiodragMTasic/agentgate/actions/workflows/ci.yml/badge.svg)](https://github.com/MiodragMTasic/agentgate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)

---

## Why AgentGate?

Every AI agent framework lets agents call tools. None of them ask **"should this agent be allowed to?"**

AgentGate is a permission layer that sits between your agent and its tools. Define who can call what, with what parameters, how often, and at what cost -- in a single YAML file.

## In Plain English

If Claude Code, Codex, OpenAI, Anthropic, or MCP can make your software **do things**, AgentGate is the layer that decides which of those things are actually allowed.

Think of the stack like this:

```text
User request
-> agent runtime chooses a tool
-> AgentGate checks policy
-> allow / deny / require approval
-> tool runs or gets blocked
```

So AgentGate is not "the AI." It is the policy firewall in front of the AI's tools.

## What AgentGate Does Not Do

AgentGate does not pick your model for you.

You still choose that in Claude Code, Codex, OpenAI, Anthropic, or your own runtime.
AgentGate only sees the resulting tool call and decides whether that call is allowed.

## How This Could Help Wanderlust

Wanderlust already has the kind of actions an AI helper could easily misuse:

- reading project files and docs
- running build, test, and deploy commands
- touching Firebase Admin-backed endpoints
- touching Stripe onboarding flows
- sending user-facing email
- creating reservation or travel handoff actions

AgentGate would let you expose those as tools while keeping control.

For example, you could let Claude Code or Codex:

- read trip-planning docs and safe source files
- run `pnpm test`, `pnpm lint`, and `pnpm build`
- inspect safe public trip data

while blocking or approval-gating:

- `.env` and secret file reads
- Firebase Admin writes
- Stripe Connect or payout-related writes
- production deploys
- user-facing outbound email
- any destructive shell command

That is the whole value proposition in one sentence:

**your agent can still help, but it cannot quietly cross trust boundaries.**

## What Onboarding Would Look Like For Wanderlust

If I were onboarding AgentGate into Wanderlust, I would not start by guarding everything.

I would start with just three tools:

1. `read_project_file`
   This lets Claude Code or Codex read docs, routes, and safe source files.
2. `run_safe_command`
   This allows things like `pnpm test`, `pnpm lint`, and `pnpm build`.
3. `deploy_preview`
   This stays approval-gated from day one.

That first version already gives you a meaningful safety boundary:

- the agent can understand the project
- the agent can verify changes
- the agent cannot read secrets
- the agent cannot quietly deploy

Then the second layer would be business tools:

- `send_beta_feedback_email`
- `start_stripe_connect_onboarding`
- `create_reservation_handoff`
- `write_firebase_admin_record`

Those are exactly the kinds of actions where AgentGate matters, because they cross from "helpful coding assistant" into "this system can affect users, money, or production state."

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
- `v0.1.0` is published on npm and released on GitHub.
- The live proof matrix passes against:
  - Codex login via ChatGPT subscription
  - Claude Code login via Claude subscription
  - local MCP transport

## Best Onboarding Path

If you are coming from Claude Code or Codex, the most natural onboarding is:

1. use the CLI to generate a starter policy and onboarding doc
2. expose your risky project actions as MCP tools
3. put AgentGate in front of those tools
4. let Claude Code or Codex call the guarded MCP server

For that path, start here:

```bash
pnpm dlx @miodragmtasic/agentgate-cli init --runtime claude-code
```

or:

```bash
pnpm dlx @miodragmtasic/agentgate-cli init --runtime codex
```

If you are integrating directly into the vendor SDK instead of Claude Code or Codex:

```bash
pnpm dlx @miodragmtasic/agentgate-cli init --runtime anthropic
pnpm dlx @miodragmtasic/agentgate-cli init --runtime openai
```

Those commands create:

- `agentgate.policy.yml`
- `agentgate.scenarios.yml`
- `agentgate.onboarding.md`

The important part is that the generated starter now matches the runtime you actually use.

## Accessible First Run

If you want the simplest possible starting point, this is the path I recommend:

```bash
pnpm dlx @miodragmtasic/agentgate-cli init --runtime claude-code --project-name Wanderlust
```

Then open the generated `agentgate.onboarding.md` and do only this:

1. rename the sample tools to match real Wanderlust actions
2. keep one safe read, one safe command, and one approval-gated action
3. run `agentgate policy validate`
4. run `agentgate test`
5. only then wire it into your MCP or runtime integration

That gives you a small, understandable first success instead of a giant security rewrite.

## Visual Explainer

If you want the "show me what this thing actually does" version instead of reading prose:

```bash
pnpm onboarding:serve
```

Then open:

```text
http://localhost:4173
```

That single-page explainer walks through:

- where AgentGate sits in the stack
- the difference between Claude Code / Codex tandem mode and raw SDK mode
- when API keys are actually needed
- what a first Wanderlust rollout would look like

## CLI Quick Start

```bash
pnpm dlx @miodragmtasic/agentgate-cli init --runtime claude-code
pnpm dlx @miodragmtasic/agentgate-cli policy validate
pnpm dlx @miodragmtasic/agentgate-cli test
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

## Live Provider Proof

If you want to validate AgentGate against real OpenAI and Anthropic tool-calling flows, start with the setup helper:

```bash
pnpm live:setup
```

That command prepares [`.env.local.example`](./.env.local.example) as your working local template if needed, shows which provider keys are missing, and points you to the provider pages you need.

Then run whichever proof you want:

```bash
pnpm live:openai
pnpm live:anthropic
pnpm live:mcp
pnpm live:matrix
```

Important:

- OpenAI live proof can run either with a logged-in Codex session or with `OPENAI_API_KEY`.
- If Codex already works on your machine, `pnpm live:openai` can reuse that auth.
- Use `pnpm live:openai -- --api` if you explicitly want the lower-level Responses API path.
- Anthropic live proof can run either with `ANTHROPIC_API_KEY` or with a logged-in Claude Code session.
- If Claude Code already works on your machine, `pnpm live:anthropic` can reuse that auth.
- Raw OpenAI API billing is still separate from ChatGPT subscriptions when you choose the API-key path.

## Test It Like a User

The most natural user story is not "I open a dashboard." It is "I already use Codex, Claude Code, or MCP, and I want AgentGate sitting in front of the tools."

### Fastest proof on your own machine

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/MiodragMTasic/agentgate.git
cd agentgate
pnpm install
```

2. Make sure your agent runtimes already work:

```bash
codex login status
claude auth status
```

If Codex is logged in with ChatGPT and Claude Code is logged in, you do not need raw API keys for the default tandem proof.

3. Run the full proof matrix:

```bash
pnpm live:matrix
```

4. Read the generated report:

```bash
cat output/live-proof/*/summary.md
```

That run proves three things:

- OpenAI-style tandem flow via logged-in Codex
- Anthropic-style tandem flow via logged-in Claude Code
- MCP transport flow via a real local stdio server/client boundary

### Test a single surface

```bash
pnpm live:openai
pnpm live:anthropic
pnpm live:mcp
```

### Force the lower-level SDK/API path

If you specifically want to test the raw vendor SDK layer instead of the subscription-backed CLI tandem path:

```bash
pnpm live:openai -- --api
```

and/or provide `ANTHROPIC_API_KEY` for the direct Anthropic SDK path.

## Not Yet Proven

- Raw OpenAI Responses API proof using a valid `OPENAI_API_KEY` in this checkout
- Raw Anthropic SDK proof using a valid `ANTHROPIC_API_KEY` in this checkout
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
  model: process.env.ANTHROPIC_MODEL ?? 'your-anthropic-model',
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
