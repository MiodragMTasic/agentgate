/**
 * AgentGate + OpenAI SDK — Basic Example
 *
 * Demonstrates three integration patterns:
 *   1. gateTool()           — wraps individual tool definitions
 *   2. gateRunToolsParams() — wraps runTools() params in one call
 *   3. gateToolExecutors()  — wraps a map of executor functions
 *
 * Run: pnpm start
 */

import { AgentGate, consoleSink } from '@agentgate/core';
import { gateTool, gateRunToolsParams, gateToolExecutors } from '@agentgate/openai';
import type { Identity } from '@agentgate/core';

// ── 1. Create gate with inline policy file ────────────────────────

const gate = new AgentGate({
  policies: new URL('./agentgate.policy.yml', import.meta.url).pathname,
  audit: {
    sinks: [consoleSink()],
    logAllowed: true,
  },
  debug: true,
});

// ── 2. Define identities ─────────────────────────────────────────

const editorIdentity: Identity = {
  id: 'agent_data_editor',
  roles: ['editor'],
  attributes: { team: 'data-ops' },
};

const viewerIdentity: Identity = {
  id: 'agent_readonly',
  roles: ['viewer'],
};

// ── 3. Pattern 1: gateTool() — individual tool wrapping ───────────

const queryTool = gateTool(gate, {
  definition: {
    type: 'function',
    function: {
      name: 'query_database',
      description: 'Run a read-only database query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL SELECT query' },
          table: { type: 'string', description: 'Target table' },
        },
        required: ['query', 'table'],
      },
    },
  },
  execute: async (args) => ({
    rows: [{ id: 1, name: 'Sample row' }],
    count: 1,
    query: args.query,
  }),
  identity: editorIdentity,
});

// ── 4. Run the demo ───────────────────────────────────────────────

async function main() {
  console.log('\n=== AgentGate + OpenAI Basic Example ===\n');

  // Test 1: Allowed query
  console.log('--- Test 1: query_database SELECT (should ALLOW) ---');
  const result1 = await queryTool.execute({
    query: 'SELECT * FROM users LIMIT 10',
    table: 'users',
  });
  console.log('Result:', JSON.stringify(result1), '\n');

  // Test 2: Denied — destructive query
  console.log('--- Test 2: query_database with DROP (should DENY) ---');
  try {
    await queryTool.execute({
      query: 'DROP TABLE users',
      table: 'users',
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.log('Denied:', error.message, '\n');
  }

  // Test 3: Denied — disallowed table
  console.log('--- Test 3: query_database on restricted table (should DENY) ---');
  try {
    await queryTool.execute({
      query: 'SELECT * FROM admin_secrets',
      table: 'admin_secrets',
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.log('Denied:', error.message, '\n');
  }

  // ── Pattern 2: gateRunToolsParams() ────────────────────────────
  //    Wraps the entire runTools() params object. Every tool.function.function
  //    call gets intercepted by AgentGate before execution.

  console.log('--- Test 4: gateRunToolsParams() ---');

  const originalParams = {
    model: 'gpt-4.1',
    messages: [{ role: 'user' as const, content: 'Update the order status' }],
    tools: [
      {
        type: 'function' as const,
        function: {
          name: 'update_record',
          description: 'Update a database record',
          parameters: {
            type: 'object',
            properties: {
              table: { type: 'string' },
              id: { type: 'string' },
              data: { type: 'object' },
            },
          },
          function: async (args: unknown) => {
            const { table, id } = args as { table: string; id: string };
            return { updated: true, table, id };
          },
        },
      },
    ],
  };

  const gatedParams = gateRunToolsParams(gate, editorIdentity, originalParams);

  // Simulate calling the gated function directly
  const updateFn = gatedParams.tools[0]!.function.function!;
  const updateResult = await updateFn({ table: 'orders', id: 'ord_123', data: { status: 'shipped' } });
  console.log('Update result:', JSON.stringify(updateResult), '\n');

  // ── Pattern 3: gateToolExecutors() ─────────────────────────────
  //    Wraps a simple name->function map. Useful with the Responses API
  //    where you handle tool dispatch yourself.

  console.log('--- Test 5: gateToolExecutors() ---');

  const executors = {
    query_database: async (args: Record<string, unknown>) => ({
      rows: [{ id: 1 }],
      table: args.table,
    }),
    manage_users: async (args: Record<string, unknown>) => ({
      created: true,
      user: args.name,
    }),
  };

  // Gate with viewer identity — should allow query but deny manage_users
  const gatedExecutors = gateToolExecutors(gate, executors, viewerIdentity);

  const queryResult = await gatedExecutors.query_database!({
    query: 'SELECT count(*) FROM products',
    table: 'products',
  });
  console.log('Viewer query:', JSON.stringify(queryResult));

  const manageResult = await gatedExecutors.manage_users!({
    name: 'new_user',
    role: 'viewer',
  });
  console.log('Viewer manage_users:', JSON.stringify(manageResult), '\n');

  // ── Cleanup ────────────────────────────────────────────────────
  await gate.shutdown();
  console.log('=== Done ===\n');
}

main().catch(console.error);

// ── How to use with OpenAI's runTools (real API call) ─────────────
//
// If you have an OPENAI_API_KEY:
//
//   import OpenAI from 'openai';
//
//   const openai = new OpenAI();
//
//   const gatedParams = gateRunToolsParams(gate, editorIdentity, {
//     model: 'gpt-4.1',
//     messages: [{ role: 'user', content: 'Show me recent orders' }],
//     tools: [
//       {
//         type: 'function',
//         function: {
//           name: 'query_database',
//           parameters: { ... },
//           function: async (args) => db.query(args.query),
//           parse: JSON.parse,
//         },
//       },
//     ],
//   });
//
//   const runner = openai.chat.completions.runTools(gatedParams);
//   const result = await runner.finalContent();
