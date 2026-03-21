/**
 * AgentGate — Human-in-the-Loop Approval Example
 *
 * Demonstrates the HITL approval flow where high-risk tool calls
 * are paused and routed to a human supervisor for approval before
 * execution continues.
 *
 * Uses ConsoleTransport which prompts in the terminal for y/n approval.
 * In production, swap ConsoleTransport for WebhookTransport or a custom
 * transport that integrates with Slack, email, or a dashboard.
 *
 * Run: pnpm start
 */

import { AgentGate, ConsoleTransport, consoleSink } from '@agentgate/core';
import { gateTool } from '@agentgate/anthropic';
import type { Identity, HITLTransport, ApprovalRequest, ApprovalResponse } from '@agentgate/core';

// ── 1. Choose a transport ─────────────────────────────────────────
//
// ConsoleTransport: prompts "Approve? (y/n)" in the terminal
// For non-interactive demo, we use AutoApproveTransport below.

// Use auto-approve for demo (swap to ConsoleTransport for interactive mode)
const USE_INTERACTIVE = process.argv.includes('--interactive');

class AutoApproveTransport implements HITLTransport {
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    console.log(`  [AutoApprove] Reviewing: ${request.tool}`);
    console.log(`    Reason:  ${request.reason}`);
    console.log(`    Agent:   ${request.identity.id}`);
    console.log(`    Params:  ${JSON.stringify(request.params)}`);
    console.log(`    Decision: AUTO-APPROVED (demo mode)\n`);

    return {
      requestId: request.id,
      decision: 'approve',
      respondedBy: 'auto-approve-transport',
      respondedAt: new Date(),
      note: 'Auto-approved for demo purposes',
    };
  }
}

const transport = USE_INTERACTIVE ? new ConsoleTransport() : new AutoApproveTransport();

// ── 2. Create gate with HITL enabled ──────────────────────────────

const gate = new AgentGate({
  policies: new URL('./agentgate.policy.yml', import.meta.url).pathname,
  audit: {
    sinks: [consoleSink()],
    logAllowed: true,
  },
  hitl: {
    transport,
    timeout: 300_000, // 5 minutes
    timeoutAction: 'deny',
  },
  debug: true,
});

// ── 3. Listen for approval events ─────────────────────────────────

gate.on('approval:requested', (data) => {
  const req = data as ApprovalRequest;
  console.log(`  [Event] Approval requested for "${req.tool}" by ${req.identity.id}`);
});

gate.on('approval:approved', (data) => {
  const req = data as ApprovalRequest;
  console.log(`  [Event] Approved: "${req.tool}"`);
});

gate.on('approval:denied', (data) => {
  const req = data as ApprovalRequest;
  console.log(`  [Event] Denied: "${req.tool}"`);
});

// ── 4. Define identity ────────────────────────────────────────────

const agentIdentity: Identity = {
  id: 'agent_cs_01',
  roles: ['agent'],
  attributes: { department: 'customer-service' },
};

// ── 5. Create tools ───────────────────────────────────────────────

const searchTool = gateTool(gate, {
  name: 'search_knowledge_base',
  description: 'Search internal knowledge base',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
  },
  identity: agentIdentity,
  run: async (input) =>
    JSON.stringify({
      results: [
        { title: 'Return Policy', snippet: 'Returns accepted within 30 days...' },
        { title: 'Refund Process', snippet: 'Refunds are processed within 5-7 days...' },
      ],
      query: input.query,
    }),
});

const emailTool = gateTool(gate, {
  name: 'send_customer_email',
  description: 'Send an email to a customer (requires supervisor approval)',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  },
  identity: agentIdentity,
  run: async (input) =>
    JSON.stringify({ sent: true, to: input.to, subject: input.subject }),
});

const refundTool = gateTool(gate, {
  name: 'process_refund',
  description: 'Process a customer refund (requires supervisor approval)',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      amount: { type: 'number' },
      reason: { type: 'string' },
    },
    required: ['orderId', 'amount', 'reason'],
  },
  identity: agentIdentity,
  run: async (input) =>
    JSON.stringify({
      refunded: true,
      orderId: input.orderId,
      amount: input.amount,
    }),
});

const deleteTool = gateTool(gate, {
  name: 'delete_account',
  description: 'Delete a customer account (requires supervisor approval)',
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string' },
      reason: { type: 'string', enum: ['customer_request', 'fraud', 'compliance'] },
      confirm: { type: 'boolean' },
    },
    required: ['accountId', 'reason', 'confirm'],
  },
  identity: agentIdentity,
  run: async (input) =>
    JSON.stringify({ deleted: true, accountId: input.accountId }),
});

// ── 6. Run the demo ───────────────────────────────────────────────

async function main() {
  console.log('\n=== AgentGate — Human-in-the-Loop Approval Example ===');
  console.log(`Mode: ${USE_INTERACTIVE ? 'INTERACTIVE (you approve in terminal)' : 'AUTO-APPROVE (demo)'}`);
  console.log('Tip: Run with --interactive to approve/deny in the terminal\n');

  // Step 1: Low-risk action — no approval needed
  console.log('--- Step 1: Search knowledge base (no approval needed) ---');
  const searchResult = await searchTool.run({ query: 'refund policy' });
  console.log('Result:', searchResult, '\n');

  // Step 2: High-risk action — requires approval
  console.log('--- Step 2: Send customer email (requires approval) ---');
  const emailResult = await emailTool.run({
    to: 'customer@example.com',
    subject: 'Your refund has been processed',
    body: 'Dear customer, your refund of $49.99 has been processed...',
  });
  console.log('Result:', emailResult, '\n');

  // Step 3: Critical action — requires approval + budget tracking
  console.log('--- Step 3: Process refund (requires approval) ---');
  const refundResult = await refundTool.run({
    orderId: 'ORD-2024-1234',
    amount: 49.99,
    reason: 'Defective product',
  });
  console.log('Result:', refundResult, '\n');

  // Step 4: Dangerous action — requires approval + param validation
  console.log('--- Step 4: Delete account (requires approval + param checks) ---');
  const deleteResult = await deleteTool.run({
    accountId: 'ACC-5678',
    reason: 'customer_request',
    confirm: true,
  });
  console.log('Result:', deleteResult, '\n');

  // Check remaining budget
  const budget = await gate.getBudget(agentIdentity);
  if (budget) {
    console.log('--- Budget status ---');
    console.log(JSON.stringify(budget, null, 2), '\n');
  }

  await gate.shutdown();
  console.log('=== Done ===\n');
}

main().catch(console.error);
