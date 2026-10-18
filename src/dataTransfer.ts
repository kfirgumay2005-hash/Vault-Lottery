// Export / import of wheel presets, saved note filters, custom dice and rosters (JSON in the vault).

import { Notice, TFile } from "obsidian";
import type VaultLotteryPlugin from "./main";
import { EXPORT_PREFIX } from "./games/notes/NoteFilter";
import { createUniqueNote, timestamp } from "./shared/insertResult";
import { pickItem } from "./shared/modals";
import { uid } from "./shared/random";
import { uniqueName } from "./shared/SavedSetBar";
import { emptyFilter, mergeDeep, normalizeRoster, type CustomDie, type Preset, type Roster, type SavedFilter } from "./settings";

interface ExportFile {
	type: "vault-lottery-export";
	version: 1;
	exportedAt: string;
	wheelPresets: Preset[];
	noteFilters: SavedFilter[];
	customDice: CustomDie[];
	rosters: Roster[];
}

export async function exportData(plugin: VaultLotteryPlugin): Promise<void> {
	const d = plugin.data;
	const out: ExportFile = {
		type: "vault-lottery-export",
		version: 1,
		exportedAt: new Date().toISOString(),
		wheelPresets: d.wheel.presets,
		noteFilters: d.notes.savedFilters,
		customDice: d.dice.dice.customDice,
		rosters: d.teams.rosters,
	};
	const { date, time } = timestamp();
	try {
		const f = await createUniqueNote(plugin.app, "", `${EXPORT_PREFIX} ${date} ${time}`, JSON.stringify(out, null, 2), "json");
		new Notice(`Exported to ${f.path}`);
	} catch (e) {
		console.error("Vault Lottery: export failed", e);
		new Notice("Export failed.");
	}
}

/** Merges with new ids for colliding ids and " (2)" names for colliding names. */
function mergeList<T extends { id: string; name: string }>(target: T[], incoming: unknown, fix: (x: T) => T): number {
	if (!Array.isArray(incoming)) return 0;
	let n = 0;
	for (const raw of incoming) {
		if (!raw || typeof raw !== "object") continue;
		const item = fix(raw as T);
		if (typeof item.name !== "string" || !item.name) item.name = "Imported";
		if (!item.id || target.some((t) => t.id === item.id)) item.id = uid();
		item.name = uniqueName(item.name, target.map((t) => t.name));
		target.push(item);
		n++;
	}
	return n;
}

export async function importData(plugin: VaultLotteryPlugin, onDone: () => void): Promise<void> {
	const files = plugin.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === "json");
	const file = await pickItem<TFile>(plugin.app, files, (f) => f.path, "Choose a Vault Lottery export (.json)…");
	if (!file) return;
	let json: Partial<ExportFile>;
	try {
		json = JSON.parse(await plugin.app.vault.read(file)) as Partial<ExportFile>;
	} catch {
		new Notice("That file isn't valid JSON.");
		return;
	}
	if (json.type !== "vault-lottery-export") {
		new Notice("That file isn't a Vault Lottery export.");
		return;
	}
	const d = plugin.data;
	const presets = mergeList(d.wheel.presets, json.wheelPresets, (p) => ({ ...p, slices: Array.isArray(p.slices) ? p.slices : [] }));
	const filters = mergeList(d.notes.savedFilters, json.noteFilters, (f) => ({
		...f,
		filter: mergeDeep(emptyFilter(), f.filter),
		excludedNotes: Array.isArray(f.excludedNotes) ? f.excludedNotes : [],
	}));
	const dice = mergeList(d.dice.dice.customDice, json.customDice, (c) => ({
		...c,
		faces: Array.isArray(c.faces) ? c.faces.map(String).slice(0, 20) : ["A", "B"],
	}));
	const rosters = mergeList(d.teams.rosters, json.rosters, (r) => normalizeRoster(r));
	plugin.saveSoon();
	new Notice(`Imported ${presets} presets, ${filters} filters, ${dice} custom dice, ${rosters} rosters.`);
	onDone();
}
