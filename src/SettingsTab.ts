// Settings tab: only neutral options (general, media, data), declared with Obsidian's settings API so they show
// up in the settings search. Everything game-specific is set inside the game, in the view.

import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type VaultLotteryPlugin from "./main";
import { exportData, importData } from "./dataTransfer";
import { confirm } from "./shared/modals";
import { GAME_NAMES } from "./settings";

export class VaultLotterySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: VaultLotteryPlugin) {
		super(app, plugin);
	}

	/** Keys are paths into the plugin data, e.g. "media.removeMode". */
	getControlValue(key: string): unknown {
		let v: unknown = this.plugin.data;
		for (const part of key.split(".")) v = (v as Record<string, unknown> | undefined)?.[part];
		return v;
	}

	setControlValue(key: string, value: unknown): void {
		const parts = key.split(".");
		const last = parts.pop();
		if (!last) return;
		let obj = this.plugin.data as unknown as Record<string, unknown>;
		for (const part of parts) obj = obj[part] as Record<string, unknown>;
		obj[last] = value;
		this.plugin.saveSoon();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const p = this.plugin;
		return [
			{
				type: "group",
				items: [
					{
						name: "Game on open",
						desc: "Which game the view shows when it opens.",
						control: { type: "dropdown", key: "defaultGame", options: { last: "Last used", ...GAME_NAMES } },
					},
					{
						name: "Confetti intensity",
						control: { type: "dropdown", key: "confettiIntensity", options: { low: "Low", medium: "Medium", high: "High" } },
					},
					{
						name: "Game options",
						desc: "Each game's options, sounds and background are set inside the game, in the Vault Lottery view.",
						searchable: false,
					},
				],
			},
			{
				type: "group",
				heading: "Media",
				items: [
					{
						name: "Delete replaced files",
						desc: "When you replace or remove an image, sound or video that the plugin added, the old file is removed, unless something else in the vault still uses it.",
						control: { type: "toggle", key: "media.deleteReplaced" },
					},
					{
						name: "Removed files go to",
						desc: "Trash: you can still get them back (Obsidian's trash setting in Files and links). Delete permanently: frees the space right away, can't be undone. Used for replaced files and for the unused-files cleanup.",
						control: { type: "dropdown", key: "media.removeMode", options: { trash: "Trash", permanent: "Delete permanently" } },
					},
					{
						name: "Find unused media",
						desc: "Scans the whole vault (notes, canvases, Obsidian and plugin settings) and lists the files in your attachment folder that nothing uses, so you can delete them.",
						action: () => void p.openMediaCleanup(),
					},
				],
			},
			{
				type: "group",
				heading: "Data",
				items: [
					{
						name: "Export",
						desc: "Writes wheel presets, saved note filters, custom dice and rosters to a JSON file in the vault root.",
						action: () => void exportData(p),
					},
					{
						name: "Import",
						desc: "Merges a Vault Lottery export from the vault. Items with the same name get a number added.",
						action: () => void importData(p, () => {
							p.refreshViews();
							this.update();
						}),
					},
					{
						name: "Reset everything",
						desc: "Restores all settings, presets, filters, rosters and history to the defaults.",
						action: () => void this.reset(),
					},
				],
			},
		];
	}

	private async reset(): Promise<void> {
		const ok = await confirm(this.app, "Reset Vault Lottery?", "All presets, filters, rosters, custom dice and history will be deleted.", "Reset", true);
		if (!ok) return;
		await this.plugin.resetData();
		this.update();
	}

	hide(): void {
		this.plugin.audio.stopPreview();
		this.plugin.refreshViews();
	}
}
