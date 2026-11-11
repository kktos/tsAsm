import type { DefinitionSite } from "../utils/error.utils";

export interface NamelessLabel {
	address: number;
	/** Where it's defined, kept by pass 2 when the assembler reports references. */
	site?: DefinitionSite;
}

/**
 * Anonymous labels (`:`), identified by their definition order. Both passes meet them in the same order,
 * so each expansion of a `.repeat` body or a macro is its own label.
 * A reference counts labels in that order too, from where it is: `:-` is the last one met, `:+` the next one,
 * whatever their addresses (two segments at the same address, overlays, don't see each other's labels).
 */
export class NamelessLabels {
	/** In definition order. */
	private labels: NamelessLabel[] = [];
	/** How many labels the pass has met: in pass 2, the index of the next label to update. */
	private met = 0;

	clear() {
		this.labels = [];
		this.met = 0;
	}

	/** In definition order. */
	all(): readonly NamelessLabel[] {
		return this.labels;
	}

	/** Pass 1: defines the next anonymous label. */
	add(address: number, site?: DefinitionSite): void {
		const label: NamelessLabel = { address };
		if (site) label.site = site;
		this.labels.push(label);
		this.met = this.labels.length;
	}

	/** Before pass 2: the next update() is for the first label. */
	rewind() {
		this.met = 0;
	}

	/**
	 * Pass 2: sets the address of the next anonymous label.
	 * @returns its pass-1 address, or undefined if pass 1 didn't define it
	 */
	update(address: number, site?: DefinitionSite): number | undefined {
		const label = this.labels[this.met];
		if (!label) {
			this.add(address, site);
			return undefined;
		}
		this.met++;
		if (site) label.site = site;

		const pass1Address = label.address;
		label.address = address;
		return pass1Address;
	}

	/**
	 * The anonymous label `distance` labels away from where the pass is, in definition order.
	 * A label on the same line as the reference, before it, is already met: `: bne :+` goes to the next one,
	 * `: lda :-` reads its own.
	 * @param distance - Negative = backward (-1 for `:-`, -2 for `:--`), positive = forward (1 for `:+`, 2 for `:++`)
	 * @returns the label, or null if there isn't one: in pass 1, a forward one isn't defined yet
	 */
	find(distance: number): NamelessLabel | null {
		if (distance === 0) return null;
		const index = distance < 0 ? this.met + distance : this.met + distance - 1;
		return (index >= 0 && this.labels[index]) || null;
	}
}
