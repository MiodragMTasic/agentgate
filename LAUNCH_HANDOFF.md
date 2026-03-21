# AgentGate Launch Handoff

Use this message as-is for the teammate handling the manual launch steps.

---

Hi, I need help with the manual launch tasks for `AgentGate`.

Repo:
- GitHub: [https://github.com/MiodragMTasic/agentgate](https://github.com/MiodragMTasic/agentgate)
- Local project path: `/Users/miodrag/MiodragDev/agentgate`

What is already done:
- The monorepo builds cleanly.
- Tests are green across the SDK, adapters, CLI, and examples.
- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build`, `pnpm test`, and `pnpm typecheck` all pass locally.
- Package tarballs were smoke-checked, and the packed CLI binary runs correctly when installed with the packed core package.
- `pnpm validate:realworld` now exercises the packed packages from a fresh outside-the-monorepo consumer install.

Publish target:
- This repo is configured to publish under the `@miodragmtasic/agentgate-*` namespace.
- Run `pnpm release:check` first. It should pass before any publish attempt.
- If it does not pass, stop and inspect the exact package name conflict or auth issue before publishing anything.

Packages currently configured in this repo:
- `@miodragmtasic/agentgate-core`
- `@miodragmtasic/agentgate-anthropic`
- `@miodragmtasic/agentgate-openai`
- `@miodragmtasic/agentgate-mcp`
- `@miodragmtasic/agentgate-cli`

Package not intended for publish right now:
- `@miodragmtasic/agentgate-shared` is private/internal.

Manual launch checklist:
1. Confirm npm auth on the release machine with `npm whoami`.
2. From `/Users/miodrag/MiodragDev/agentgate`, run one last verification:
   - `pnpm install --frozen-lockfile`
   - `pnpm lint`
   - `pnpm build`
   - `pnpm test`
   - `pnpm typecheck`
   - `pnpm validate:realworld`
   - `pnpm release:check`
3. If `pnpm release:check` fails:
   - stop the release
   - inspect the failing package name and npm auth state
   - do not publish anything until the conflict is resolved
4. Only after `pnpm release:check` passes, publish the packages in dependency order:
   - `cd packages/core && pnpm publish --access public --no-git-checks`
   - `cd ../anthropic && pnpm publish --access public --no-git-checks`
   - `cd ../openai && pnpm publish --access public --no-git-checks`
   - `cd ../mcp && pnpm publish --access public --no-git-checks`
   - `cd ../../apps/cli && pnpm publish --access public --no-git-checks`
5. After publish, verify installability from a fresh temp folder using the final resolved package names.
6. Create a GitHub release on `MiodragMTasic/agentgate` tagged `v0.1.0`.
7. Post the launch announcement on LinkedIn using the copy below, but do not claim traction or adoption that has not been independently verified.

Suggested GitHub release title:
- `AgentGate v0.1.0`

Suggested GitHub release notes:

```
AgentGate v0.1.0 is the first public release of a TypeScript-native permission layer for AI agents.

This release includes:
- `@miodragmtasic/agentgate-core` for policy evaluation, guards, rate limits, budgets, audit logging, approval flows, and capability discovery
- `@miodragmtasic/agentgate-anthropic` adapter
- `@miodragmtasic/agentgate-openai` adapter
- `@miodragmtasic/agentgate-mcp` adapter
- `@miodragmtasic/agentgate-cli` for policy validation, scenario testing, and audit inspection

Highlights:
- YAML or object-based policy definitions
- Role inheritance and parameter constraints
- Rate limiting and budget enforcement
- Human-in-the-loop approval support
- MCP-compatible server/client gating patterns
- Example projects covering Anthropic, OpenAI, MCP, HITL, and a full-stack scenario

Repository:
https://github.com/MiodragMTasic/agentgate
```

Suggested LinkedIn post:

```
I just launched AgentGate: a TypeScript-native permission layer for AI agents.

It is designed for the moment when an LLM stops being “just a chat model” and starts calling tools that can touch production systems, user data, or real-world workflows.

AgentGate gives you a policy engine in front of those tool calls, with:
- role-based access control
- parameter-level constraints
- rate limiting
- budget enforcement
- audit logging
- human-in-the-loop approval flows
- capability discovery for agents and roles

It already works with:
- Anthropic
- OpenAI
- MCP

There is also a CLI for validating policies, testing scenarios, and inspecting audit logs.

Repo:
https://github.com/MiodragMTasic/agentgate

If you are building agent systems and want a clearer boundary between “the model can suggest this” and “the system is actually allowed to do this,” I’d love to hear what you think.
```

Shorter fallback LinkedIn post:

```
Launched AgentGate today.

It is a TypeScript-native permission layer for AI agents, with policies for tool access, parameter constraints, rate limits, budgets, audit logs, and approval flows.

Supported today:
- Anthropic
- OpenAI
- MCP

Repo:
https://github.com/MiodragMTasic/agentgate
```

If anything blocks publish:
- Send me the exact command, error output, and the package that failed.
- Most likely failure points are npm auth, package ownership/access, or package-name availability.

Thanks.
