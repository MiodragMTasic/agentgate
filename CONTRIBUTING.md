# Contributing to AgentGate

Thanks for your interest in contributing. This guide covers the basics.

## Development Setup

**Prerequisites:** Node.js >= 18, pnpm >= 9

```bash
git clone https://github.com/MiodragMTasic/agentgate.git
cd agentgate
pnpm install
pnpm build
```

## Project Structure

```
packages/
  core/         Policy engine, guards, rate limiter, budget, audit, HITL
  anthropic/    Anthropic SDK adapter
  openai/       OpenAI SDK adapter
  mcp/          MCP adapter
  shared/       Shared utilities
apps/
  cli/          CLI tool
examples/       Example projects
```

## Workflow

1. Fork the repository and create a branch from `main`.
2. Make your changes. Add or update tests as needed.
3. Run checks before submitting:

```bash
pnpm lint          # Biome linter
pnpm typecheck     # TypeScript type checking
pnpm test          # Vitest test suite
pnpm build         # Ensure everything compiles
```

4. Open a pull request against `main`.

## Commit Messages

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat(core): add time-based policy conditions
fix(anthropic): handle undefined identity in gateTool
docs: update quick start example
test(mcp): add GateMcpServer integration tests
chore: update dependencies
```

## Adding a New Adapter

1. Create a new package under `packages/` with `@miodragmtasic/agentgate-core` as a dependency.
2. Follow the patterns in `packages/anthropic` or `packages/openai`.
3. Add the package to the packages table in `README.md`.
4. Add an example project under `examples/`.

## Code Style

- Biome handles formatting and linting. Run `pnpm lint:fix` to auto-fix.
- Semicolons are enforced by the Biome config.
- Prefer explicit types over `any`.

## Changesets

This project uses [changesets](https://github.com/changesets/changesets) for versioning.

When your PR includes user-facing changes, add a changeset:

```bash
pnpm changeset
```

Follow the prompts to describe your change and select the affected packages.

## Reporting Issues

Open an issue on GitHub. Include:

- What you expected to happen
- What actually happened
- Minimal reproduction steps
- Node.js and package versions

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
