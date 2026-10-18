// Team splitting: plain shuffle + round-robin, skill balancing (snake draft + swaps), keep-apart / keep-together.

import type { Person } from "../../settings";
import { pick, randomInt, shuffle, shuffleInPlace } from "../../shared/random";

export const DEFAULT_SKILL = 3;
const MAX_ATTEMPTS = 500;

export function teamCountFor(n: number, by: "count" | "size", value: number): number {
	if (n <= 0) return 0;
	if (by === "count") return Math.max(1, Math.min(n, Math.round(value)));
	return Math.max(1, Math.min(n, Math.round(n / Math.max(1, value))));
}

/** Sizes of k teams for n people: differ by at most 1. */
export function teamSizes(n: number, k: number): number[] {
	if (k <= 0) return [];
	const base = Math.floor(n / k);
	const extra = n % k;
	return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

function skill(p: Person): number {
	return typeof p.skill === "number" && p.skill > 0 ? p.skill : DEFAULT_SKILL;
}

export function teamSkill(team: Person[]): number {
	return team.reduce((s, p) => s + skill(p), 0);
}

function skillSpread(teams: Person[][]): number {
	const t = teams.map(teamSkill);
	return Math.max(...t) - Math.min(...t);
}

/** Plain: Fisher–Yates shuffle dealt round-robin. */
export function splitPlain(people: Person[], k: number): Person[][] {
	const teams: Person[][] = Array.from({ length: k }, () => []);
	shuffle(people).forEach((p, i) => teams[i % k].push(p));
	return teams;
}

/** Skill: sort by skill (random ties), snake draft, then random swaps that never widen the best spread found. */
export function splitBalanced(people: Person[], k: number, swapPasses = 3): Person[][] {
	const sorted = shuffle(people).sort((a, b) => skill(b) - skill(a)); // sort is stable → random tie order
	const teams: Person[][] = Array.from({ length: k }, () => []);
	sorted.forEach((p, i) => {
		const round = Math.floor(i / k);
		const pos = i % k;
		teams[round % 2 === 0 ? pos : k - 1 - pos].push(p);
	});
	if (k < 2) return teams;
	let best = skillSpread(teams);
	const swaps = swapPasses * people.length;
	for (let s = 0; s < swaps; s++) {
		const a = randomInt(0, k - 1);
		let b = randomInt(0, k - 2);
		if (b >= a) b++;
		if (!teams[a].length || !teams[b].length) continue;
		const i = randomInt(0, teams[a].length - 1);
		const j = randomInt(0, teams[b].length - 1);
		const pa = teams[a][i];
		const pb = teams[b][j];
		teams[a][i] = pb;
		teams[b][j] = pa;
		const spread = skillSpread(teams);
		if (spread <= best) best = spread;
		else {
			teams[a][i] = pa;
			teams[b][j] = pb;
		}
	}
	return teams;
}

export interface Constraint {
	a: string;
	b: string;
	kind: "apart" | "together";
}

export function violations(teams: Person[][], constraints: Constraint[]): Constraint[] {
	const teamOf = new Map<string, number>();
	teams.forEach((t, i) => t.forEach((p) => teamOf.set(p.id, i)));
	return constraints.filter((c) => {
		const ta = teamOf.get(c.a);
		const tb = teamOf.get(c.b);
		if (ta === undefined || tb === undefined) return false; // someone absent: ignore
		return c.kind === "apart" ? ta === tb : ta !== tb;
	});
}

/** Local repair: swaps people between teams while that lowers the violation count (sizes never change). */
function repair(teams: Person[][], constraints: Constraint[], balance: boolean, maxSpread: number): void {
	let current = violations(teams, constraints).length;
	if (!current) return;
	for (let iter = 0; iter < 200 && current > 0; iter++) {
		const v = pick(violations(teams, constraints));
		const id = pick([v.a, v.b]);
		const ti = teams.findIndex((t) => t.some((p) => p.id === id));
		if (ti < 0) continue;
		const pi = teams[ti].findIndex((p) => p.id === id);
		let tj: number;
		if (v.kind === "together") {
			const other = id === v.a ? v.b : v.a;
			tj = teams.findIndex((t) => t.some((p) => p.id === other));
		} else {
			tj = randomInt(0, teams.length - 2);
			if (tj >= ti) tj++;
		}
		if (tj < 0 || tj === ti || !teams[tj].length) continue;
		const pj = randomInt(0, teams[tj].length - 1);
		const a = teams[ti][pi];
		const b = teams[tj][pj];
		teams[ti][pi] = b;
		teams[tj][pj] = a;
		const after = violations(teams, constraints).length;
		const spreadOk = !balance || skillSpread(teams) <= maxSpread;
		if (after < current && spreadOk) {
			current = after;
		} else {
			teams[ti][pi] = a;
			teams[tj][pj] = b;
		}
	}
}

export interface SplitResult {
	teams: Person[][];
	violations: Constraint[];
}

export function splitTeams(
	people: Person[],
	k: number,
	opts: { balance: boolean; constraints: Constraint[] },
): SplitResult {
	if (k <= 0 || people.length === 0) return { teams: [], violations: [] };
	const ids = new Set(people.map((p) => p.id));
	const constraints = opts.constraints.filter((c) => c.a !== c.b && ids.has(c.a) && ids.has(c.b));
	const make = () => (opts.balance ? splitBalanced(people, k) : splitPlain(people, k));
	if (!constraints.length || k < 2) return { teams: make(), violations: [] };
	let best: SplitResult | null = null;
	let bestSpread = Infinity;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const teams = make();
		const spread = opts.balance ? skillSpread(teams) : 0;
		repair(teams, constraints, opts.balance, opts.balance ? spread + 1 : Infinity);
		const v = violations(teams, constraints);
		const s = opts.balance ? skillSpread(teams) : 0;
		if (!best || v.length < best.violations.length || (v.length === best.violations.length && s < bestSpread)) {
			best = { teams, violations: v };
			bestSpread = s;
		}
		if (v.length === 0 && (!opts.balance || attempt > 20)) break;
	}
	return best ?? { teams: make(), violations: [] };
}

/** Pick one present person, optionally never the same as last time. */
export function pickOne(people: Person[], lastId: string | null, noRepeat: boolean): Person | null {
	if (!people.length) return null;
	const pool = noRepeat && lastId && people.length > 1 ? people.filter((p) => p.id !== lastId) : people;
	return pick(pool);
}

export function randomOrder(people: Person[]): Person[] {
	return shuffleInPlace(people.slice());
}
