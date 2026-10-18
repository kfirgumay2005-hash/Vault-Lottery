// Dropdown + Save / Save as… / Rename / Delete, shared by wheel presets, saved note filters and rosters.

import type { App } from "obsidian";
import { confirm, prompt } from "./modals";
import { iconButton, setDisabled } from "./ui";

export interface SavedSetAdapter {
	/** Singular noun used in labels, e.g. "preset", "filter", "roster". */
	noun: string;
	items(): { id: string; name: string }[];
	loadedId(): string | null;
	isDirty(): boolean;
	load(id: string): void;
	/** Overwrite the loaded item with the working set. */
	save(): void;
	saveAs(name: string): void;
	rename(id: string, name: string): void;
	remove(id: string): void;
}

export class SavedSetBar {
	el: HTMLElement;
	private select!: HTMLSelectElement;
	private dot!: HTMLElement;
	private saveBtn!: HTMLButtonElement;
	private renameBtn!: HTMLButtonElement;
	private deleteBtn!: HTMLButtonElement;

	constructor(parent: HTMLElement, private app: App, private a: SavedSetAdapter) {
		this.el = parent.createDiv({ cls: "vault-lottery-setbar" });
		this.build();
	}

	private build(): void {
		const top = this.el.createDiv({ cls: "vault-lottery-setbar-row" });
		const selWrap = top.createDiv({ cls: "vault-lottery-setbar-select" });
		this.select = selWrap.createEl("select", { cls: "dropdown", attr: { "aria-label": `Load ${this.a.noun}` } });
		this.dot = selWrap.createSpan({ cls: "vault-lottery-dirty-dot", attr: { "aria-label": "Unsaved changes" } });
		this.select.addEventListener("change", () => void this.onSelect());
		const btns = top.createDiv({ cls: "vault-lottery-setbar-buttons" });
		this.saveBtn = iconButton(btns, "save", `Save ${this.a.noun}`, () => {
			this.a.save();
			this.update();
		});
		iconButton(btns, "copy-plus", "Save as…", () => void this.saveAs());
		this.renameBtn = iconButton(btns, "pencil", `Rename ${this.a.noun}`, () => void this.rename());
		this.deleteBtn = iconButton(btns, "trash-2", `Delete ${this.a.noun}`, () => void this.remove());
		this.update();
	}

	update(): void {
		const items = this.a.items();
		const loaded = this.a.loadedId();
		this.select.empty();
		const none = this.select.createEl("option", { text: items.length ? `— Unsaved ${this.a.noun} —` : `No saved ${this.a.noun}s` });
		none.value = "";
		for (const it of items) {
			const o = this.select.createEl("option", { text: it.name });
			o.value = it.id;
		}
		this.select.value = loaded && items.some((i) => i.id === loaded) ? loaded : "";
		const hasLoaded = this.select.value !== "";
		const dirty = this.a.isDirty();
		this.dot.toggleClass("is-visible", dirty);
		this.dot.setAttr("title", dirty ? "Unsaved changes" : "");
		setDisabled(this.saveBtn, !hasLoaded);
		setDisabled(this.renameBtn, !hasLoaded);
		setDisabled(this.deleteBtn, !hasLoaded);
	}

	private async onSelect(): Promise<void> {
		const id = this.select.value;
		const loaded = this.a.loadedId();
		if (!id || id === loaded) {
			this.update();
			return;
		}
		if (this.a.isDirty()) {
			const ok = await confirm(
				this.app,
				`Load ${this.a.noun}?`,
				`Your current ${this.a.noun} has unsaved changes. Loading another one replaces them.`,
				"Load",
			);
			if (!ok) {
				this.update();
				return;
			}
		}
		this.a.load(id);
		this.update();
	}

	private async saveAs(): Promise<void> {
		const name = await prompt(this.app, `Save ${this.a.noun} as`, "", { placeholder: "Name", cta: "Save" });
		if (!name) return;
		this.a.saveAs(name);
		this.update();
	}

	private async rename(): Promise<void> {
		const id = this.a.loadedId();
		const it = this.a.items().find((i) => i.id === id);
		if (!it) return;
		const name = await prompt(this.app, `Rename ${this.a.noun}`, it.name, { cta: "Rename" });
		if (!name) return;
		this.a.rename(it.id, name);
		this.update();
	}

	private async remove(): Promise<void> {
		const id = this.a.loadedId();
		const it = this.a.items().find((i) => i.id === id);
		if (!it) return;
		const ok = await confirm(this.app, `Delete ${this.a.noun}?`, `Delete "${it.name}"? This can't be undone.`, "Delete", true);
		if (!ok) return;
		this.a.remove(it.id);
		this.update();
	}
}

/** Picks a name that isn't taken yet ("Name", "Name (2)", …). */
export function uniqueName(name: string, taken: string[]): string {
	if (!taken.includes(name)) return name;
	let i = 2;
	while (taken.includes(`${name} (${i})`)) i++;
	return `${name} (${i})`;
}
