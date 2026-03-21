import type { Identity } from '@miodragmtasic/agentgate-core';

export interface GateToolOptions<TInput = Record<string, unknown>> {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	identity: Identity | ((input: TInput) => Identity | Promise<Identity>);
	run: (input: TInput) => string | Promise<string>;
}

export interface GateZodToolOptions<TInput = Record<string, unknown>> {
	name: string;
	description?: string;
	schema: unknown; // Zod schema
	identity: Identity | ((input: TInput) => Identity | Promise<Identity>);
	run: (input: TInput) => string | Promise<string>;
}

export interface GateToolRunnerOptions {
	identity: Identity;
}
