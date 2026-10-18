import { describe, expect, it } from "vitest";
import {
	addDie, describe as describeRoll, evaluate, formatNotation, isSingleD20, parseNotation, removeDie, reroll, roll,
	type DieResult, type ParsedNotation,
} from "../src/games/dice/DiceNotation";
import type { CustomDie } from "../src/settings";

function ok(s: string, custom: CustomDie[] = []): ParsedNotation {
	const r = parseNotation(s, custom);
	if (!r.ok) throw new Error(`expected ${s} to parse: ${r.error}`);
	return r.value;
}

function dice(values: number[], sides: number, group = 0): DieResult[] {
	return values.map((value) => ({ group, sides, value, kept: true, held: false }));
}

describe("parseNotation: valid", () => {
	it("2d6+3", () => {
		const p = ok("2d6+3");
		expect(p.groups).toHaveLength(1);
		expect(p.groups[0]).toMatchObject({ count: 2, sides: 6, sign: 1 });
		expect(p.modifier).toBe(3);
		expect(p.diceCount).toBe(2);
	});
	it("d20 (implicit count)", () => {
		expect(ok("d20").groups[0]).toMatchObject({ count: 1, sides: 20 });
	});
	it("3d8-1", () => {
		const p = ok("3d8-1");
		expect(p.groups[0]).toMatchObject({ count: 3, sides: 8 });
		expect(p.modifier).toBe(-1);
	});
	it("4d6kh3", () => {
		expect(ok("4d6kh3").groups[0].keep).toEqual({ mode: "h", n: 3 });
	});
	it("2d20kl1", () => {
		expect(ok("2d20kl1").groups[0].keep).toEqual({ mode: "l", n: 1 });
	});
	it("dN for any N (d2, d7, d1000) and d%", () => {
		expect(ok("d2").groups[0].sides).toBe(2);
		expect(ok("d7").groups[0].sides).toBe(7);
		expect(ok("d1000").groups[0].sides).toBe(1000);
		expect(ok("d%").groups[0].sides).toBe(100);
	});
	it("whitespace and upper case", () => {
		expect(ok(" 2D6 + 1d4 - 2 ").groups).toHaveLength(2);
	});
	it("custom dice by name (case-insensitive)", () => {
		const custom: CustomDie[] = [{ id: "c1", name: "Dinner", faces: ["Pizza", "Sushi", "Burger"] }];
		const p = ok("2d[dinner]", custom);
		expect(p.groups[0]).toMatchObject({ count: 2, sides: 3 });
	});
	it("custom dice with spaces in the name", () => {
		const custom: CustomDie[] = [{ id: "c1", name: "Custom 1", faces: ["A", "B", "C"] }];
		expect(ok("1d[Custom 1]", custom).groups[0]).toMatchObject({ count: 1, sides: 3 });
		expect(ok("1d[ custom  1 ] + 2", custom).groups[0].custom?.id).toBe("c1");
		expect(formatNotation(ok("2d[Custom 1]", custom))).toBe("2d[Custom 1]");
	});
});

describe("parseNotation: invalid", () => {
	const bad = ["", "abc", "2d", "d1", "d1001", "21d6", "0d6", "4d6kh5", "4d6kh0", "2d6+", "2d6++3", "d6 d6", "1d6k", "d[Nope]", "5", "2d6*2"];
	for (const s of bad) {
		it(JSON.stringify(s), () => {
			const r = parseNotation(s);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
		});
	}
	it("limits to 20 dice in total", () => {
		expect(parseNotation("10d6+10d8").ok).toBe(true);
		expect(parseNotation("10d6+11d8").ok).toBe(false);
	});
});

describe("roll / evaluate", () => {
	it("totals stay in range for 2d6+3", () => {
		const p = ok("2d6+3");
		for (let i = 0; i < 2000; i++) {
			const r = roll(p);
			expect(r.total).toBeGreaterThanOrEqual(5);
			expect(r.total).toBeLessThanOrEqual(15);
			expect(r.dice).toHaveLength(2);
		}
	});

	it("keep highest drops the lowest dice", () => {
		const r = evaluate(ok("4d6kh3"), dice([3, 6, 1, 4], 6));
		expect(r.dice.filter((d) => d.kept).map((d) => d.value).sort()).toEqual([3, 4, 6]);
		expect(r.dice.find((d) => d.value === 1)?.kept).toBe(false);
		expect(r.total).toBe(13);
	});

	it("keep highest with ties drops exactly one die", () => {
		const r = evaluate(ok("4d6kh3"), dice([2, 2, 2, 5], 6));
		expect(r.dice.filter((d) => !d.kept)).toHaveLength(1);
		expect(r.total).toBe(9);
	});

	it("keep lowest (disadvantage)", () => {
		expect(evaluate(ok("2d20kl1"), dice([17, 4], 20)).total).toBe(4);
	});

	it("subtracting groups", () => {
		const r = evaluate(ok("d20-d4"), [...dice([10], 20, 0), ...dice([3], 4, 1)]);
		expect(r.total).toBe(7);
		expect(describeRoll(ok("d20-d4"), r)).toBe("7 (10 - 3)");
	});

	it("reroll keeps held dice and rerolls the rest", () => {
		const p = ok("5d6");
		const first = roll(p);
		first.dice[0].held = true;
		first.dice[2].held = true;
		for (let i = 0; i < 50; i++) {
			const next = reroll(p, first);
			expect(next.dice[0].value).toBe(first.dice[0].value);
			expect(next.dice[2].value).toBe(first.dice[2].value);
			expect(next.dice[0].held).toBe(true);
			expect(next.dice[1].held).toBe(false);
		}
	});

	it("describe formats the breakdown", () => {
		const p = ok("2d6+3");
		expect(describeRoll(p, evaluate(p, dice([4, 5], 6)))).toBe("12 (4 + 5 + 3)");
		const single = ok("d20");
		expect(describeRoll(single, evaluate(single, dice([17], 20)))).toBe("17");
	});

	it("custom dice show their faces and have no total", () => {
		const custom: CustomDie[] = [{ id: "c1", name: "Dinner", faces: ["Pizza", "Sushi"] }];
		const p = ok("d[Dinner]", custom);
		const r = roll(p);
		expect(r.total).toBeNull();
		expect(["Pizza", "Sushi"]).toContain(describeRoll(p, r));
	});
});

describe("tray helpers", () => {
	it("format round-trips", () => {
		for (const s of ["2d6+3", "1d20", "4d6kh3", "2d20kl1-1", "1d4+2d8", "1d20-1d4"]) expect(formatNotation(ok(s))).toBe(s);
	});
	it("addDie / removeDie", () => {
		let p: ParsedNotation | null = ok("1d6");
		p = addDie(p, 6);
		expect(formatNotation(p)).toBe("2d6");
		p = addDie(p, 20);
		expect(formatNotation(p)).toBe("2d6+1d20");
		p = removeDie(p, 6);
		expect(p && formatNotation(p)).toBe("1d6+1d20");
		p = removeDie(p as ParsedNotation, 20);
		p = removeDie(p as ParsedNotation, 6);
		expect(p).toBeNull();
	});
	it("removing from a keep group shrinks the keep count", () => {
		const p = removeDie(ok("3d6kh3"), 6);
		expect(p && formatNotation(p)).toBe("2d6kh2");
	});
	it("single d20 detection", () => {
		expect(isSingleD20(ok("d20"))).toBe(true);
		expect(isSingleD20(ok("2d20"))).toBe(false);
		expect(isSingleD20(ok("d20+1"))).toBe(true);
	});
});
