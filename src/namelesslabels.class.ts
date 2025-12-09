interface NamelessLabel {
	line: string | number;
	column: number;
	address: number;
}

export class NamelessLabels {
	private labels: NamelessLabel[] = [];

	clear() {
		this.labels = [];
	}

	add(address: number, { line, column }: { line: string | number; column: number }): void {
		const existing = this.labels.find((l) => l.line === line && l.column === column);

		if (existing) existing.address = address;
		else this.labels.push({ line, column, address });

		this.labels.sort((a, b) => a.address - b.address);
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
		if (this.labels.length === 0) return null;

		// Binary search for insertion point (where currentAddress would go)
		let left = 0;
		let right = this.labels.length;
		while (left < right) {
			const mid = Math.floor((left + right) / 2);
			if ((this.labels[mid]?.address ?? 0) < currentAddress) left = mid + 1;
			else right = mid;
		}

		// left is now the index of the first label >= currentAddress

		if (distance < 0) {
			// Backward: need to find labels strictly before currentAddress
			// Check if there's a label exactly at currentAddress
			const hasLabelAtCurrent = left < this.labels.length && this.labels[left]?.address === currentAddress;

			// If there's a label at current address, count it as "behind us"
			const backwardIndex = hasLabelAtCurrent ? left : left - 1;
			const targetIndex = backwardIndex + distance + 1; // +1 because distance=-1 means "first backward"

			if (targetIndex >= 0) return this.labels[targetIndex]?.address ?? 0;
		} else if (distance > 0) {
			// Forward: distance = 1 means first label after currentAddress
			const targetIndex = left + distance - 1; // left + 0 for distance=1, left + 1 for distance=2, etc.
			if (targetIndex < this.labels.length) return this.labels[targetIndex]?.address ?? 0;
		}

		return null;
	}
}
