export type CostCalculator = (params: Record<string, unknown>) => number;

export class CostRegistry {
	private fixedCosts = new Map<string, number>();
	private dynamicCosts = new Map<string, CostCalculator>();

	register(tool: string, cost: number): void;
	register(tool: string, calculator: CostCalculator): void;
	register(tool: string, costOrCalculator: number | CostCalculator): void {
		if (typeof costOrCalculator === 'number') {
			this.fixedCosts.set(tool, costOrCalculator);
			this.dynamicCosts.delete(tool);
		} else {
			this.dynamicCosts.set(tool, costOrCalculator);
			this.fixedCosts.delete(tool);
		}
	}

	getCost(tool: string, params: Record<string, unknown> = {}): number {
		const calculator = this.dynamicCosts.get(tool);
		if (calculator) {
			return calculator(params);
		}

		const fixed = this.fixedCosts.get(tool);
		if (fixed !== undefined) {
			return fixed;
		}

		return 0;
	}
}
