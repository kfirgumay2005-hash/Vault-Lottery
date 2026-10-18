// Settings tab: only neutral options (general) and data.
// Everything game-specific is set inside the game, in the view.

import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultLotteryPlugin from "./main";
import { exportData, importData } from "./dataTransfer";
import { buildConfettiGlobal } from "./shared/appearance";
import { confirm } from "./shared/modals";
import { GAME_NAMES, type GameId } from "./settings";

export class VaultLotterySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: VaultLotteryPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const scroll = containerEl.scrollTop;
		containerEl.empty();
		containerEl.addClass("vault-lottery-settings");
		const p = this.plugin;
		const d = p.data;
		const redraw = () => {
			this.display();
		};

		// ---------- General ----------
		new Setting(containerEl).setName("General").setHeading();
		new Setting(containerEl).setName("Game on open").setDesc("Which game the view shows when it opens.").addDropdown((dd) => {
			dd.addOption("last", "Last used");
			for (const id of Object.keys(GAME_NAMES) as GameId[]) dd.addOption(id, GAME_NAMES[id]);
			dd.setValue(d.defaultGame).onChange((v) => {
				d.defaultGame = v as GameId | "last";
				p.saveSoon();
			});
		});
		buildConfettiGlobal(containerEl, p);
		containerEl.createDiv({
			cls: "setting-item-description vault-lottery-settings-note",
			text: "Each game's options, sounds and background are set inside the game, in the Vault Lottery view.",
		});

		// ---------- Media ----------
		new Setting(containerEl).setName("Media").setHeading();
		new Setting(containerEl)
			.setName("Delete replaced files")
			.setDesc("When you replace or remove an image, sound or video that the plugin added, the old file is removed, unless something else in the vault still uses it.")
			.addToggle((t) => t.setValue(d.media.deleteReplaced).onChange((v) => {
				d.media.deleteReplaced = v;
				p.saveSoon();
			}));
		new Setting(containerEl)
			.setName("Removed files go to")
			.setDesc("Trash: you can still get them back (Obsidian's trash setting in Files and links). Delete permanently: frees the space right away, can't be undone. Used for replaced files and for the unused-files cleanup.")
			.addDropdown((dd) => dd.addOptions({ trash: "Trash", permanent: "Delete permanently" }).setValue(d.media.removeMode).onChange((v) => {
				d.media.removeMode = v as "trash" | "permanent";
				p.saveSoon();
			}));
		new Setting(containerEl)
			.setName("Unused media")
			.setDesc("Scans the whole vault (notes, canvases, Obsidian and plugin settings) and lists the files in your attachment folder that nothing uses, so you can delete them.")
			.addButton((b) => b.setButtonText("Find unused files…").onClick(() => void p.openMediaCleanup()));

		// ---------- Data ----------
		new Setting(containerEl).setName("Data").setHeading();
		new Setting(containerEl)
			.setName("Export")
			.setDesc("Writes wheel presets, saved note filters, custom dice and rosters to a JSON file in the vault root.")
			.addButton((b) => b.setButtonText("Export").onClick(() => void exportData(p)));
		new Setting(containerEl)
			.setName("Import")
			.setDesc("Merges a Vault Lottery export from the vault. Items with the same name get a number added.")
			.addButton((b) => b.setButtonText("Import…").onClick(() => void importData(p, () => {
				p.refreshViews();
				redraw();
			})));
		new Setting(containerEl)
			.setName("Reset everything")
			.setDesc("Restores all settings, presets, filters, rosters and history to the defaults.")
			.addButton((b) => b.setButtonText("Reset").setWarning().onClick(async () => {
				const ok = await confirm(this.app, "Reset Vault Lottery?", "All presets, filters, rosters, custom dice and history will be deleted.", "Reset", true);
				if (!ok) return;
				await p.resetData();
				redraw();
			}));

		containerEl.scrollTop = scroll;
	}

	hide(): void {
		this.plugin.audio.stopPreview();
		this.plugin.refreshViews();
	}
}
