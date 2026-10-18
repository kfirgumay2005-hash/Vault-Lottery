import { describe, expect, it } from "vitest";
import { pick, randomFloat, randomInt, shuffle, weightedIndex } from "../src/shared/random";

describe("randomInt", () => {
	it("stays inside the inclusive range", () => {
		for (let i = 0; i < 5000; i++) {
			const v = randomInt(-3, 4);
			expect(v).toBeGreaterThanOrEqual(-3);
			expect(v).toBeLessThanOrEqual(4);
			expect(Number.isInteger(v)).toBe(true);
		}
	});

	it("returns the only value of a one-value range", () => {
		expect(randomInt(7, 7)).toBe(7);
	});

	it("throws on an empty range", () => {
		expect(() => randomInt(5, 4)).toThrow();
	});

	it("has no modulo bias (range 3, chi-square)", () => {
		const N = 60000;
		const counts = [0, 0, 0];
		for (let i = 0; i < N; i++) counts[randomInt(0, 2)]++;
		const exp = N / 3;
		const chi = counts.reduce((s, c) => s + ((c - exp) ** 2) / exp, 0);
		expect(chi).toBeLessThan(13.8); // p = 0.001, df = 2
	});

	it("is uniform over a non-power-of-two range (d6)", () => {
		const N = 60000;
		const counts = new Array(6).fill(0);
		for (let i = 0; i < N; i++) counts[randomInt(1, 6) - 1]++;
		const exp = N / 6;
		const chi = counts.reduce((s, c) => s + ((c - exp) ** 2) / exp, 0);
		expect(chi).toBeLessThan(20.5); // p = 0.001, df = 5
	});

	it("rejection sampling: the top of a huge range is reachable and unbiased", () => {
		// range = 3 * 2^30: naive modulo would make the first third twice as likely as the rest
		const range = 3 * 2 ** 30;
		const N = 30000;
		const thirds = [0, 0, 0];
		for (let i = 0; i < N; i++) thirds[Math.floor(randomInt(0, range - 1) / 2 ** 30)]++;
		for (const t of thirds) expect(t / N).toBeCloseTo(1 / 3, 1);
	});
});

describe("randomFloat", () => {
	it("is in [0, 1)", () => {
		for (let i = 0; i < 5000; i++) {
			const f = randomFloat();
			expect(f).toBeGreaterThanOrEqual(0);
			expect(f).toBeLessThan(1);
		}
	});
});

describe("shuffle", () => {
	it("keeps all elements", () => {
		const a = Array.from({ length: 50 }, (_, i) => i);
		expect(shuffle(a).sort((x, y) => x - y)).toEqual(a);
	});

	it("is uniform over all permutations of 3 elements", () => {
		const N = 60000;
		const counts = new Map<string, number>();
		for (let i = 0; i < N; i++) {
			const k = shuffle([1, 2, 3]).join("");
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		expect(counts.size).toBe(6);
		const exp = N / 6;
		const chi = Array.from(counts.values()).reduce((s, c) => s + ((c - exp) ** 2) / exp, 0);
		expect(chi).toBeLessThan(20.5);
	});

	it("is uniform over all permutations of 4 elements", () => {
		const N = 96000;
		const counts = new Map<string, number>();
		for (let i = 0; i < N; i++) {
			const k = shuffle([1, 2, 3, 4]).join("");
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		expect(counts.size).toBe(24);
		const exp = N / 24;
		const chi = Array.from(counts.values()).reduce((s, c) => s + ((c - exp) ** 2) / exp, 0);
		expect(chi).toBeLessThan(49.7); // p = 0.001, df = 23
	});
});

describe("weightedIndex", () => {
	it("follows the weights", () => {
		const N = 40000;
		const counts = [0, 0, 0];
		for (let i = 0; i < N; i++) counts[weightedIndex([1, 2, 7])]++;
		expect(counts[0] / N).toBeCloseTo(0.1, 1);
		expect(counts[1] / N).toBeCloseTo(0.2, 1);
		expect(counts[2] / N).toBeCloseTo(0.7, 1);
	});

	it("never picks zero-weight items", () => {
		for (let i = 0; i < 2000; i++) expect(weightedIndex([0, 5, 0])).toBe(1);
	});
});

describe("pick", () => {
	it("throws on empty arrays", () => {
		expect(() => pick([])).toThrow();
	});
});
