# AgentGate LinkedIn Post

I just finished shipping AgentGate v0.1.0.

AgentGate is a permission layer for AI agents. It sits between an agent and its tools, and decides:

- who is allowed to call what
- with which parameters
- how often
- at what cost
- and when human approval is required

The reason I built it is simple: most agent frameworks focus on giving models tool access, but not on governing that access once the tools become real.

If an agent can run shell commands, send email, query a database, inspect tenant settings, or move money, the important question stops being “can the model call tools?” and becomes “should this exact action be allowed right now?”

What AgentGate includes today:

- YAML policy engine
- parameter constraints
- rate limiting
- budget tracking
- audit logging
- human-in-the-loop approvals
- capability discovery
- adapters for Anthropic, OpenAI, and MCP
- CLI for policy validation and scenario testing

The part I’m especially happy with is that we now proved it the way real developer-users actually use these systems:

- OpenAI-style tandem flow via logged-in Codex
- Anthropic-style tandem flow via logged-in Claude Code
- MCP tool flow over a real local stdio transport

We also ran a live proof matrix across realistic scenarios like:

- refunds
- outbound sales email
- read-only vs destructive database access
- safe vs dangerous shell commands
- finance payouts with approval and budget ceilings
- legal/compliance restrictions
- pricing changes
- tenant-scoped admin access

Repo:
https://github.com/MiodragMTasic/agentgate

Packages:

- `@miodragmtasic/agentgate-core`
- `@miodragmtasic/agentgate-anthropic`
- `@miodragmtasic/agentgate-openai`
- `@miodragmtasic/agentgate-mcp`
- `@miodragmtasic/agentgate-cli`

If you’re building agents that can touch real systems, I think this layer is going to matter a lot.

Short version:

Launched AgentGate v0.1.0.

It’s a permission layer for AI agents: policy checks, param constraints, rate limits, budgets, audit logs, and approval flows in front of real tool use.

Validated with Codex, Claude Code, and MCP-style tool flows.

Repo:
https://github.com/MiodragMTasic/agentgate
