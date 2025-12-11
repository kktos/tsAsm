import { getHex } from "../utils/hex.util";

interface NamelessLabel {
	address: number;
	file: string;
	line: string | number;
	column: number;
}

export class NamelessLabels {
	private labels: NamelessLabel[] = [];

	clear() {
		this.labels = [];
	}

	add({ address, line, column, file }: NamelessLabel): void {
		const existing = this.labels.find((l) => l.file === file && l.line === line && l.column === column);

		if (existing) existing.address = address;
		else this.labels.push({ file, line, column, address });

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

		let targetIndex = 0;
		if (distance < 0) {
			// Backward: need to find labels strictly before currentAddress
			// Check if there's a label exactly at currentAddress
			const hasLabelAtCurrent = left < this.labels.length && this.labels[left]?.address === currentAddress;

			// If there's a label at current address, count it as "behind us"
			const backwardIndex = hasLabelAtCurrent ? left : left - 1;
			targetIndex = backwardIndex + distance + 1; // +1 because distance=-1 means "first backward"

			if (targetIndex >= 0) return this.labels[targetIndex]?.address ?? 0;
		} else if (distance > 0) {
			// Forward: distance = 1 means first label after currentAddress
			targetIndex = left + distance - 1; // left + 0 for distance=1, left + 1 for distance=2, etc.
			if (targetIndex < this.labels.length) return this.labels[targetIndex]?.address ?? 0;
		}

		console.log("findNearest", getHex(currentAddress), distance, targetIndex);
		console.log(
			"labels",
			this.labels.map((l, i) => `${i.toString().padStart(3, " ")}: ${getHex(l.address)} @${l.line}:${l.column}`),
		);

		return null;
	}
}
