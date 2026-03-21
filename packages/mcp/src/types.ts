import type { Identity } from '@miodragmtasic/agentgate-core';

export interface GateMcpServerConfig {
	name: string;
	version: string;
	description?: string;
}

export interface GateMcpToolConfig {
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}

export interface MCPServerContext {
	sessionId?: string;
	[key: string]: unknown;
}

export type IdentityResolver = (ctx: MCPServerContext) => Identity | Promise<Identity>;
