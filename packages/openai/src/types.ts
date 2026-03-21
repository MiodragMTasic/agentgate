import type { Identity } from '@agentgate/core';

export interface GateOpenAIToolOptions {
	definition: {
		type: 'function';
		function: {
			name: string;
			description?: string;
			parameters?: Record<string, unknown>;
		};
	};
	execute: (args: Record<string, unknown>) => unknown | Promise<unknown>;
	identity: Identity | ((args: Record<string, unknown>) => Identity | Promise<Identity>);
}

export interface GatedOpenAITool {
	definition: GateOpenAIToolOptions['definition'];
	execute: (args: Record<string, unknown>) => Promise<unknown>;
}
