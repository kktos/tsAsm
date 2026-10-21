interface NamelessLabel {
	address: number;
}

/**
 * Anonymous labels (`:`), identified by their definition order. Both passes meet them in the same order,
 * so each expansion of a `.repeat` body or a macro is its own label.
 */
export class NamelessLabels {
	/** In definition order. */
	private labels: NamelessLabel[] = [];
	/** The same labels, sorted by address, for findNearest. */
	private byAddress: NamelessLabel[] = [];
	/** Pass 2: index of the next label to update. */
	private nextIndex = 0;

	clear() {
		this.labels = [];
		this.byAddress = [];
		this.nextIndex = 0;
	}

	/** Pass 1: defines the next anonymous label. */
	add(address: number): void {
		const label = { address };
		this.labels.push(label);
		this.byAddress.push(label);
		this.byAddress.sort((a, b) => a.address - b.address);
	}

	/** Before pass 2: the next update() is for the first label. */
	rewind() {
		this.nextIndex = 0;
	}

	/**
	 * Pass 2: sets the address of the next anonymous label.
	 * @returns its pass-1 address, or undefined if pass 1 didn't define it
	 */
	update(address: number): number | undefined {
		const label = this.labels[this.nextIndex++];
		if (!label) {
			this.add(address);
			return undefined;
		}

		const pass1Address = label.address;
		if (pass1Address !== address) {
			label.address = address;
			this.byAddress.sort((a, b) => a.address - b.address);
		}
		return pass1Address;
	}

	/**
	 * Find a nameless label relative to the current address
	 * @param currentAddress - The address to search from
	 * @param distance - Number of labels to skip:
	 *                   Negative = backward (e.g., -1 for :-, -2 for :--)
	 *                   Positive = forward (e.g., 1 for :+, 2 for :++)
	 * @returns The address of the target label, or null if not found
	 */
	findNearest(currentAddress: number, distance: number): number | null {
		if (this.byAddress.length === 0) return null;

		// Binary search for insertion point (where currentAddress would go)
		let left = 0;
		let right = this.byAddress.length;
		while (left < right) {
			const mid = Math.floor((left + right) / 2);
			if ((this.byAddress[mid]?.address ?? 0) < currentAddress) left = mid + 1;
			else right = mid;
		}

		// left is now the index of the first label >= currentAddress

		let targetIndex = 0;
		if (distance < 0) {
			// Backward: need to find labels strictly before currentAddress
			// Check if there's a label exactly at currentAddress
			const hasLabelAtCurrent = left < this.byAddress.length && this.byAddress[left]?.address === currentAddress;

			// If there's a label at current address, count it as "behind us"
			const backwardIndex = hasLabelAtCurrent ? left : left - 1;
			targetIndex = backwardIndex + distance + 1; // +1 because distance=-1 means "first backward"

			if (targetIndex >= 0) return this.byAddress[targetIndex]?.address ?? 0;
		} else if (distance > 0) {
			// Forward: labels strictly after currentAddress. A label at currentAddress is "behind us" (see above),
			// e.g. in `: bne :+` the label on the same line is not the target.
			let firstAfter = left;
			while (firstAfter < this.byAddress.length && this.byAddress[firstAfter]?.address === currentAddress) firstAfter++;

			targetIndex = firstAfter + distance - 1; // firstAfter + 0 for distance=1, firstAfter + 1 for distance=2, etc.
			if (targetIndex < this.byAddress.length) return this.byAddress[targetIndex]?.address ?? 0;
		}

		return null;
	}
}
