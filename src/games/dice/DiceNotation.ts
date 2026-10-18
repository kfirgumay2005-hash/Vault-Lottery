// Dice notation parser and roller: "2d6+3", "d20", "3d8-1", "4d6kh3", "2d20kl1", "d%", "2d[Dinner]".

import type { CustomDie } from "../../settings";
import { randomInt } from "../../shared/random";

export const MAX_DICE = 20;
export const MIN_SIDES = 2;
export const MAX_SIDES = 1000;
export const STANDARD_DICE = [4, 6, 8, 10, 12, 20, 100];

export interface DiceGroup {
	sign: 1 | -1;
	count: number;
	/** Number of sides for numeric dice. */
	sides: number;
	/** Set for custom text dice (sides = faces.length). */
	custom?: CustomDie;
	keep?: { mode: "h" | "l"; n: number };
}

export interface ParsedNotation {
	groups: DiceGroup[];
	modifier: number;
	diceCount: number;
}

export type ParseResult = { ok: true; value: ParsedNotation } | { ok: false; error: string };

export function parseNotation(input: string, customDice: CustomDie[] = []): ParseResult {
	// Spaces are ignored, except inside a custom die's name: "2d[Custom 1]"
	const src = input.replace(/\[[^\]]*\]|\s+/g, (m) => (m.startsWith("[") ? m : ""));
	if (!src) return { ok: false, error: "Enter dice, e.g. 2d6+3" };
	const groups: DiceGroup[] = [];
	let modifier = 0;
	let i = 0;
	let first = true;
	const err = (msg: string): ParseResult => ({ ok: false, error: msg });

	while (i < src.length) {
		let sign: 1 | -1 = 1;
		if (src[i] === "+" || src[i] === "-") {
			sign = src[i] === "-" ? -1 : 1;
			i++;
		} else if (!first) {
			return err(`Unexpected "${src[i]}"`);
		}
		first = false;
		const rest = src.slice(i);
		// Dice term
		const m = rest.match(/^(\d*)[dD](\d+|%|\[[^\]]+\])((?:k[hl]?|K[HL]?)\d+)?/);
		if (m) {
			const count = m[1] === "" ? 1 : parseInt(m[1], 10);
			if (!Number.isFinite(count) || count < 1) return err("Dice count must be at least 1");
			let sides: number;
			let custom: CustomDie | undefined;
			if (m[2] === "%") {
				sides = 100;
			} else if (m[2].startsWith("[")) {
				const name = m[2].slice(1, -1).trim();
				custom = customDice.find((c) => dieKey(c.name) === dieKey(name));
				if (!custom) return err(`Unknown custom die "${name}"`);
				if (custom.faces.length < 2) return err(`Custom die "${custom.name}" needs at least 2 faces`);
				sides = custom.faces.length;
			} else {
				sides = parseInt(m[2], 10);
				if (sides < MIN_SIDES || sides > MAX_SIDES) return err(`Dice need ${MIN_SIDES}–${MAX_SIDES} sides`);
			}
			let keep: DiceGroup["keep"];
			if (m[3]) {
				if (custom) return err("Keep highest/lowest only works with numeric dice");
				const km = m[3].toLowerCase().match(/^k([hl]?)(\d+)$/);
				if (!km) return err("Invalid keep rule");
				const n = parseInt(km[2], 10);
				if (n < 1 || n > count) return err(`Can only keep 1–${count} dice`);
				keep = { mode: km[1] === "l" ? "l" : "h", n };
			}
			groups.push({ sign, count, sides, custom, keep });
			i += m[0].length;
			continue;
		}
		const n = rest.match(/^\d+/);
		if (n) {
			const v = parseInt(n[0], 10);
			if (v > 100000) return err("Modifier is too large");
			modifier += sign * v;
			i += n[0].length;
			continue;
		}
		return err(rest[0] ? `Unexpected "${rest[0]}"` : "Incomplete notation");
	}
	if (!groups.length) return err("Add at least one die, e.g. d20");
	const diceCount = groups.reduce((s, g) => s + g.count, 0);
	if (diceCount > MAX_DICE) return err(`At most ${MAX_DICE} dice per roll`);
	return { ok: true, value: { groups, modifier, diceCount } };
}

/** Custom die names match ignoring case and repeated spaces. */
function dieKey(name: string): string {
	return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function formatNotation(p: ParsedNotation): string {
	let s = "";
	p.groups.forEach((g, idx) => {
		const sign = g.sign < 0 ? "-" : idx === 0 ? "" : "+";
		const die = g.custom ? `[${g.custom.name}]` : String(g.sides);
		const keep = g.keep ? `k${g.keep.mode}${g.keep.n}` : "";
		s += `${sign}${g.count}d${die}${keep}`;
	});
	if (p.modifier > 0) s += `+${p.modifier}`;
	else if (p.modifier < 0) s += `${p.modifier}`;
	return s;
}

export interface DieResult {
	group: number;
	sides: number;
	/** Face value 1..sides. */
	value: number;
	/** Face text for custom dice. */
	label?: string;
	kept: boolean;
	held: boolean;
}

export interface RollResult {
	dice: DieResult[];
	/** Sum of kept numeric dice + modifier; null when the roll has only custom dice. */
	total: number | null;
	modifier: number;
}

function rollGroupDie(g: DiceGroup, group: number): DieResult {
	const value = randomInt(1, g.sides);
	return { group, sides: g.sides, value, label: g.custom ? g.custom.faces[value - 1] : undefined, kept: true, held: false };
}

/** Marks kept/dropped dice for keep-highest/lowest and computes the total. */
export function evaluate(p: ParsedNotation, dice: DieResult[]): RollResult {
	p.groups.forEach((g, gi) => {
		const ds = dice.filter((d) => d.group === gi);
		for (const d of ds) d.kept = true;
		if (g.keep) {
			const sorted = ds.slice().sort((a, b) => (g.keep?.mode === "h" ? b.value - a.value : a.value - b.value));
			for (let k = g.keep.n; k < sorted.length; k++) sorted[k].kept = false;
		}
	});
	let total = p.modifier;
	let numeric = false;
	for (const d of dice) {
		const g = p.groups[d.group];
		if (g.custom || !d.kept) continue;
		numeric = true;
		total += g.sign * d.value;
	}
	return { dice, total: numeric ? total : null, modifier: p.modifier };
}

export function roll(p: ParsedNotation): RollResult {
	const dice: DieResult[] = [];
	p.groups.forEach((g, gi) => {
		for (let k = 0; k < g.count; k++) dice.push(rollGroupDie(g, gi));
	});
	return evaluate(p, dice);
}

/** Rerolls only the unheld dice (holds are kept). */
export function reroll(p: ParsedNotation, prev: RollResult): RollResult {
	const dice = prev.dice.map((d) => (d.held ? { ...d } : { ...rollGroupDie(p.groups[d.group], d.group), held: false }));
	return evaluate(p, dice);
}

/** "12 (4 + 5 + 3)" style breakdown. */
export function describe(p: ParsedNotation, r: RollResult): string {
	const parts: string[] = [];
	const labels: string[] = [];
	r.dice.forEach((d) => {
		const g = p.groups[d.group];
		if (g.custom) {
			labels.push(d.label ?? String(d.value));
			return;
		}
		if (!d.kept) return;
		parts.push(`${g.sign < 0 ? "-" : ""}${d.value}`);
	});
	if (r.modifier) parts.push(String(r.modifier));
	let s = "";
	if (r.total !== null) {
		const breakdown = parts.join(" + ").replace(/\+ -/g, "- ");
		s = parts.length > 1 ? `${r.total} (${breakdown})` : String(r.total);
	}
	if (labels.length) s = s ? `${s} · ${labels.join(", ")}` : labels.join(", ");
	return s;
}

/** Command / insert format: "2d6+3 → 12 (4 + 5 + 3)". */
export function resultLine(p: ParsedNotation, r: RollResult): string {
	return `${formatNotation(p)} → ${describe(p, r)}`;
}

/** Adds one die of `sides` (or a custom die) to the notation. */
export function addDie(p: ParsedNotation | null, sides: number, custom?: CustomDie): ParsedNotation {
	const groups = p ? p.groups.map((g) => ({ ...g })) : [];
	const g = groups.find((x) => !x.keep && x.sign === 1 && (custom ? x.custom?.id === custom.id : !x.custom && x.sides === sides));
	if (g) g.count++;
	else groups.push({ sign: 1, count: 1, sides: custom ? custom.faces.length : sides, custom });
	return { groups, modifier: p?.modifier ?? 0, diceCount: groups.reduce((s, x) => s + x.count, 0) };
}

/** Removes one die of `sides` (or the custom die). Returns null when nothing is left. */
export function removeDie(p: ParsedNotation, sides: number, customId?: string): ParsedNotation | null {
	const groups = p.groups.map((g) => ({ ...g }));
	for (let i = groups.length - 1; i >= 0; i--) {
		const g = groups[i];
		const match = customId ? g.custom?.id === customId : !g.custom && g.sides === sides;
		if (!match) continue;
		g.count--;
		if (g.keep && g.keep.n > g.count) g.keep = g.count > 0 ? { ...g.keep, n: g.count } : undefined;
		if (g.count <= 0) groups.splice(i, 1);
		break;
	}
	if (!groups.length) return null;
	return { groups, modifier: p.modifier, diceCount: groups.reduce((s, x) => s + x.count, 0) };
}

/** True for a single plain d20 (critical / fumble detection). */
export function isSingleD20(p: ParsedNotation): boolean {
	return p.groups.length === 1 && p.groups[0].count === 1 && p.groups[0].sides === 20 && !p.groups[0].custom;
}
