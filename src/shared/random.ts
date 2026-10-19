// All randomness in the plugin goes through this module (crypto.getRandomValues).

const BUF = new Uint32Array(64);
let bufPos = BUF.length;

function cryptoObj(): Crypto {
	return window.crypto;
}

/** Uniform 32-bit unsigned integer. */
export function randomUint32(): number {
	if (bufPos >= BUF.length) {
		cryptoObj().getRandomValues(BUF);
		bufPos = 0;
	}
	return BUF[bufPos++];
}

/** Uniform float in [0, 1) with 53 bits of precision. */
export function randomFloat(): number {
	const hi = randomUint32() >>> 5; // 27 bits
	const lo = randomUint32() >>> 6; // 26 bits
	return (hi * 67108864 + lo) / 9007199254740992;
}

/** Uniform float in [min, max). */
export function randomRange(min: number, max: number): number {
	return min + randomFloat() * (max - min);
}

/** Uniform integer in [min, max] (inclusive) without modulo bias (rejection sampling). */
export function randomInt(min: number, max: number): number {
	min = Math.ceil(min);
	max = Math.floor(max);
	if (max < min) throw new RangeError(`randomInt: empty range ${min}..${max}`);
	const range = max - min + 1;
	if (range === 1) return min;
	if (range > 0x100000000) {
		// Larger than 32 bits: combine floats (not needed in practice, kept for safety).
		return min + Math.floor(randomFloat() * range);
	}
	const limit = Math.floor(0x100000000 / range) * range;
	let x = randomUint32();
	while (x >= limit) x = randomUint32();
	return min + (x % range);
}

/** Random element of a non-empty array. */
export function pick<T>(arr: readonly T[]): T {
	if (arr.length === 0) throw new RangeError("pick: empty array");
	return arr[randomInt(0, arr.length - 1)];
}

/** Index chosen with probability proportional to its weight (cumulative weights). */
export function weightedIndex(weights: readonly number[]): number {
	let total = 0;
	const cumulative = new Array<number>(weights.length);
	for (let i = 0; i < weights.length; i++) {
		const w = weights[i];
		total += Number.isFinite(w) && w > 0 ? w : 0;
		cumulative[i] = total;
	}
	if (total <= 0) return randomInt(0, weights.length - 1);
	const r = randomFloat() * total;
	// Binary search for the first cumulative weight > r.
	let lo = 0;
	let hi = cumulative.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (cumulative[mid] > r) hi = mid;
		else lo = mid + 1;
	}
	return lo;
}

/** Element chosen with probability proportional to weight(item). */
export function weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
	return items[weightedIndex(items.map(weight))];
}

/** Fisher–Yates shuffle, in place. Returns the same array. */
export function shuffleInPlace<T>(arr: T[]): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = randomInt(0, i);
		const t = arr[i];
		arr[i] = arr[j];
		arr[j] = t;
	}
	return arr;
}

/** Shuffled copy. */
export function shuffle<T>(arr: readonly T[]): T[] {
	return shuffleInPlace(arr.slice());
}

/** Random boolean with probability p of true. */
export function chance(p = 0.5): boolean {
	return randomFloat() < p;
}

/** Short random id (not security relevant, just unique). */
export function uid(): string {
	const a = randomUint32().toString(36);
	const b = randomUint32().toString(36);
	return (a + b).slice(0, 12).padEnd(12, "0");
}

/** RFC 4122 v4 uuid. */
export function uuid(): string {
	const c = cryptoObj();
	if (typeof c.randomUUID === "function") return c.randomUUID();
	const b = new Uint8Array(16);
	c.getRandomValues(b);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
