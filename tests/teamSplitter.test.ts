import { describe, expect, it } from "vitest";
import type { Person } from "../src/settings";
import { pickOne, randomOrder, splitTeams, teamCountFor, teamSizes, teamSkill, violations } from "../src/games/teams/TeamSplitter";

function people(n: number, skills?: number[]): Person[] {
	return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, present: true, skill: skills?.[i] }));
}

describe("team sizes", () => {
	it("differ by at most 1 for every n and k", () => {
		for (let n = 1; n <= 40; n++) {
			for (let k = 1; k <= Math.min(20, n); k++) {
				const s = teamSizes(n, k);
				expect(s.reduce((a, b) => a + b, 0)).toBe(n);
				expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
			}
		}
	});

	it("split by count and by size", () => {
		expect(teamCountFor(10, "count", 3)).toBe(3);
		expect(teamCountFor(2, "count", 5)).toBe(2);
		expect(teamCountFor(10, "size", 3)).toBe(3);
		expect(teamCountFor(12, "size", 4)).toBe(3);
		expect(teamCountFor(3, "size", 50)).toBe(1);
	});

	it("splitTeams sizes differ by at most 1 (plain and balanced, both split modes)", () => {
		for (const balance of [false, true]) {
			for (let n = 2; n <= 25; n++) {
				for (const [by, v] of [["count", 2], ["count", 3], ["count", 5], ["size", 2], ["size", 3], ["size", 4]] as const) {
					const k = teamCountFor(n, by, v);
					const r = splitTeams(people(n, Array.from({ length: n }, (_, i) => (i % 5) + 1)), k, { balance, constraints: [] });
					const s = r.teams.map((t) => t.length);
					expect(s.reduce((a, b) => a + b, 0)).toBe(n);
					expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
				}
			}
		}
	});

	it("everyone appears exactly once", () => {
		const ps = people(17);
		const r = splitTeams(ps, 4, { balance: false, constraints: [] });
		expect(r.teams.flat().map((p) => p.id).sort()).toEqual(ps.map((p) => p.id).sort());
	});
});

describe("skill balancing", () => {
	it("keeps the total skill close", () => {
		const skills = [5, 5, 5, 4, 4, 3, 3, 2, 1, 1];
		for (let i = 0; i < 30; i++) {
			const r = splitTeams(people(10, skills), 2, { balance: true, constraints: [] });
			const t = r.teams.map(teamSkill);
			expect(Math.abs(t[0] - t[1])).toBeLessThanOrEqual(1);
		}
	});

	it("is much closer than a plain split on average", () => {
		const skills = [5, 5, 5, 5, 1, 1, 1, 1, 3, 3, 3, 3];
		let plain = 0;
		let balanced = 0;
		for (let i = 0; i < 100; i++) {
			const a = splitTeams(people(12, skills), 3, { balance: false, constraints: [] }).teams.map(teamSkill);
			const b = splitTeams(people(12, skills), 3, { balance: true, constraints: [] }).teams.map(teamSkill);
			plain += Math.max(...a) - Math.min(...a);
			balanced += Math.max(...b) - Math.min(...b);
		}
		expect(balanced).toBeLessThan(plain);
		expect(balanced / 100).toBeLessThanOrEqual(1);
	});
});

describe("constraints", () => {
	it("keep apart is honored when possible", () => {
		const constraints = [
			{ a: "p0", b: "p1", kind: "apart" as const },
			{ a: "p2", b: "p3", kind: "apart" as const },
		];
		for (let i = 0; i < 30; i++) {
			const r = splitTeams(people(8), 2, { balance: false, constraints });
			expect(r.violations).toHaveLength(0);
			expect(violations(r.teams, constraints)).toHaveLength(0);
		}
	});

	it("keep together is honored when possible (with skill balancing)", () => {
		const constraints = [
			{ a: "p0", b: "p1", kind: "together" as const },
			{ a: "p4", b: "p7", kind: "together" as const },
		];
		for (let i = 0; i < 30; i++) {
			const r = splitTeams(people(9, [5, 4, 3, 2, 1, 5, 4, 3, 2]), 3, { balance: true, constraints });
			expect(r.violations).toHaveLength(0);
		}
	});

	it("reports impossible constraints with the fewest violations", () => {
		// three people kept apart from each other in only 2 teams: at least one pair must share a team
		const constraints = [
			{ a: "p0", b: "p1", kind: "apart" as const },
			{ a: "p1", b: "p2", kind: "apart" as const },
			{ a: "p0", b: "p2", kind: "apart" as const },
		];
		const r = splitTeams(people(4), 2, { balance: false, constraints });
		expect(r.violations.length).toBe(1);
	});

	it("ignores constraints on absent people", () => {
		const r = splitTeams(people(4), 2, { balance: false, constraints: [{ a: "p0", b: "zz", kind: "together" }] });
		expect(r.violations).toHaveLength(0);
	});
});

describe("pick one / order", () => {
	it("never repeats the last pick when asked", () => {
		const ps = people(3);
		let last: string | null = null;
		for (let i = 0; i < 200; i++) {
			const p = pickOne(ps, last, true) as Person;
			expect(p.id).not.toBe(last);
			last = p.id;
		}
	});
	it("works with a single person even with no-repeat", () => {
		expect(pickOne(people(1), "p0", true)?.id).toBe("p0");
	});
	it("returns null for nobody", () => {
		expect(pickOne([], null, false)).toBeNull();
	});
	it("random order is a permutation", () => {
		const ps = people(12);
		expect(randomOrder(ps).map((p) => p.id).sort()).toEqual(ps.map((p) => p.id).sort());
	});
});
