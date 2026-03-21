/**
 * AgentGate + Anthropic SDK — Basic Example
 *
 * Demonstrates how to wrap Anthropic tool calls with permission guards.
 * Uses gateTool() for individual tools and createGateToolRunner() for
 * bulk wrapping of an entire tool set.
 *
 * Run: pnpm start
 */

import { AgentGate, consoleSink, parsePolicyFromFile } from '@agentgate/core';
import { gateTool, createGateToolRunner } from '@agentgate/anthropic';
import type { Identity } from '@agentgate/core';

// ── 1. Load policy & create gate ──────────────────────────────────

const gate = new AgentGate({
  policies: new URL('./agentgate.policy.yml', import.meta.url).pathname,
  audit: {
    sinks: [consoleSink()],
    logAllowed: true,
    redactParams: ['apiKey', 'password'],
  },
  debug: true,
});

// ── 2. Define the agent's identity ────────────────────────────────

const agentIdentity: Identity = {
  id: 'agent_support_01',
  roles: ['agent'],
  attributes: { department: 'customer-support' },
};

// ── 3. Create gated tools using gateTool() ────────────────────────
//    Each tool declaration mirrors Anthropic's BetaRunnableTool shape
//    but gates every invocation through AgentGate's policy engine.

const weatherTool = gateTool(gate, {
  name: 'get_weather',
  description: 'Get current weather for a location',
  inputSchema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name or coordinates' },
      units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    },
    required: ['location'],
  },
  identity: agentIdentity,
  run: async (input) => {
    // In production this would call a weather API
    return JSON.stringify({
      location: input.location,
      temp: 22,
      units: input.units ?? 'celsius',
      condition: 'sunny',
    });
  },
});

const emailTool = gateTool(gate, {
  name: 'send_email',
  description: 'Send an email to a recipient',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  },
  identity: agentIdentity,
  run: async (input) => {
    return JSON.stringify({ sent: true, to: input.to });
  },
});

// ── 4. Run the demo ───────────────────────────────────────────────

async function main() {
  console.log('\n=== AgentGate + Anthropic Basic Example ===\n');

  // Test 1: Allowed — weather lookup
  console.log('--- Test 1: get_weather (should ALLOW) ---');
  const weatherResult = await weatherTool.run({ location: 'San Francisco', units: 'fahrenheit' });
  console.log('Result:', weatherResult, '\n');

  // Test 2: Allowed — email to internal domain
  console.log('--- Test 2: send_email to @mycompany.com (should ALLOW) ---');
  const emailOk = await emailTool.run({
    to: 'alice@mycompany.com',
    subject: 'Meeting notes',
    body: 'Here are the notes from today.',
  });
  console.log('Result:', emailOk, '\n');

  // Test 3: Denied — email to competitor domain
  console.log('--- Test 3: send_email to @competitor.com (should DENY) ---');
  const emailDenied = await emailTool.run({
    to: 'info@competitor.com',
    subject: 'Hello',
    body: 'This should be blocked.',
  });
  console.log('Result:', emailDenied, '\n');

  // ── 5. Alternative: createGateToolRunner() ────────────────────
  //    Wraps an array of existing tools in one call.
  //    Useful when you already have tools defined and want to
  //    add AgentGate as a layer.

  console.log('--- Test 4: Using createGateToolRunner ---');

  const runner = createGateToolRunner(gate, agentIdentity);

  const tools = runner.wrapTools([
    {
      name: 'get_weather',
      run: async (input: unknown) =>
        JSON.stringify({ temp: 18, condition: 'cloudy' }),
    },
    {
      name: 'read_file',
      run: async (input: unknown) =>
        JSON.stringify({ content: 'file contents here' }),
    },
  ]);

  // This should be allowed (agent role + get_weather)
  const result1 = await tools[0]!.run({ location: 'London' });
  console.log('Weather via runner:', result1);

  // This should be denied (agent role can't use read_file — admin only)
  const result2 = await tools[1]!.run({ path: '/data/report.csv' });
  console.log('File read via runner:', result2, '\n');

  // ── 6. Capability discovery ─────────────────────────────────────
  //    Ask AgentGate what this identity is allowed to do.

  console.log('--- Test 5: Capability discovery ---');
  const capabilities = gate.discover(agentIdentity);
  console.log('Capabilities for agent:', JSON.stringify(capabilities, null, 2), '\n');

  // ── Cleanup ────────────────────────────────────────────────────
  await gate.shutdown();
  console.log('=== Done ===\n');
}

main().catch(console.error);

// ── How to use with Anthropic's toolRunner (real API call) ────────
//
// If you have an ANTHROPIC_API_KEY, you would use it like this:
//
//   import Anthropic from '@anthropic-ai/sdk';
//
//   const client = new Anthropic();
//   const runner = createGateToolRunner(gate, agentIdentity);
//
//   const response = await client.beta.messages.runTools({
//     model: 'claude-sonnet-4-5-20250929',
//     max_tokens: 1024,
//     ...runner.wrapParams({
//       tools: [weatherTool, emailTool],
//       messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
//     }),
//   });
//
//   console.log(response.content);
