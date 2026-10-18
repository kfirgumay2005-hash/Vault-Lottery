// Coin / dice logic shared by the game and the commands (no UI).

import type { PluginData } from "../../settings";
import { randomInt } from "../../shared/random";
import { parseNotation, resultLine, roll, type ParsedNotation, type RollResult } from "./DiceNotation";

export const HISTORY_PER_MODE = 20;

export type Side = 0 | 1;

export function flipOnce(): Side {
	return randomInt(0, 1) as Side;
}

/** Flips until one side has the majority of `bestOf`. */
export function flipSeries(bestOf: 1 | 3 | 5): Side[] {
	const need = Math.floor(bestOf / 2) + 1;
	const out: Side[] = [];
	const score = [0, 0];
	while (score[0] < need && score[1] < need) {
		const s = flipOnce();
		out.push(s);
		score[s]++;
	}
	return out;
}

export function seriesWinner(flips: Side[]): Side {
	const heads = flips.filter((f) => f === 0).length;
	return heads > flips.length - heads ? 0 : 1;
}

export function coinText(d: PluginData, flips: Side[]): string {
	const labels = d.dice.coin.labels;
	const w = seriesWinner(flips);
	if (flips.length === 1) return labels[w];
	const a = flips.filter((f) => f === 0).length;
	const b = flips.length - a;
	return `${labels[w]} (${labels[0]} ${a} – ${b} ${labels[1]})`;
}

export function addHistory(d: PluginData, mode: "coin" | "dice", text: string): void {
	const h = d.dice.history;
	h.unshift({ mode, text, at: Date.now() });
	// keep the last 20 per mode
	const counts = { coin: 0, dice: 0 };
	d.dice.history = h.filter((e) => ++counts[e.mode] <= HISTORY_PER_MODE);
}

export function currentNotation(d: PluginData): ParsedNotation | null {
	const r = parseNotation(d.dice.dice.notation, d.dice.dice.customDice);
	return r.ok ? r.value : null;
}

export function rollText(d: PluginData, notation?: string): { line: string; parsed: ParsedNotation; result: RollResult } | { error: string } {
	const r = parseNotation(notation ?? d.dice.dice.notation, d.dice.dice.customDice);
	if (!r.ok) return { error: r.error };
	const result = roll(r.value);
	return { line: resultLine(r.value, result), parsed: r.value, result };
}
