// Wheel presets: saved slice sets (slices only — audio and the background belong to the game, not a preset).

import type VaultLotteryPlugin from "../../main";
import type { Preset, Slice } from "../../settings";
import { uid } from "../../shared/random";
import { uniqueName, type SavedSetAdapter } from "../../shared/SavedSetBar";

function cloneSlices(slices: Slice[]): Slice[] {
	return slices.map((s) => ({ ...s, image: s.image ? { ...s.image } : undefined }));
}

function sameSlices(a: Slice[], b: Slice[]): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export class PresetManager {
	constructor(private plugin: VaultLotteryPlugin) {}

	private get w() {
		return this.plugin.data.wheel;
	}

	loaded(): Preset | undefined {
		return this.w.presets.find((p) => p.id === this.w.loadedPresetId);
	}

	isDirty(): boolean {
		const p = this.loaded();
		if (!p) return false;
		return !sameSlices(p.slices, this.w.workingSlices);
	}

	load(id: string): boolean {
		const p = this.w.presets.find((x) => x.id === id);
		if (!p) return false;
		this.w.workingSlices = cloneSlices(p.slices);
		this.w.loadedPresetId = p.id;
		this.plugin.saveSoon();
		return true;
	}

	adapter(onLoaded: () => void): SavedSetAdapter {
		return {
			noun: "preset",
			items: () => this.w.presets,
			loadedId: () => this.w.loadedPresetId,
			isDirty: () => this.isDirty(),
			load: (id) => {
				if (this.load(id)) onLoaded();
			},
			save: () => {
				const p = this.loaded();
				if (!p) return;
				const old = p.slices;
				p.slices = cloneSlices(this.w.workingSlices);
				this.plugin.saveSoon();
				for (const s of old) this.plugin.releaseImage(s.image);
			},
			saveAs: (name) => {
				const p: Preset = {
					id: uid(),
					name: uniqueName(name, this.w.presets.map((x) => x.name)),
					slices: cloneSlices(this.w.workingSlices),
				};
				this.w.presets.push(p);
				this.w.loadedPresetId = p.id;
				this.plugin.saveSoon();
			},
			rename: (id, name) => {
				const p = this.w.presets.find((x) => x.id === id);
				if (!p) return;
				p.name = uniqueName(name, this.w.presets.filter((x) => x.id !== id).map((x) => x.name));
				this.plugin.saveSoon();
			},
			remove: (id) => {
				const i = this.w.presets.findIndex((x) => x.id === id);
				if (i < 0) return;
				const [p] = this.w.presets.splice(i, 1);
				if (this.w.loadedPresetId === id) this.w.loadedPresetId = null;
				this.plugin.saveSoon();
				for (const s of p.slices) this.plugin.releaseImage(s.image);
			},
		};
	}
}
