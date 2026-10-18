// Note Lottery game: filtered range → slot reel → confetti → result card.

import { EventRef, Events, Modal, Setting, TFile, setIcon } from "obsidian";
import type { Game, GameContext } from "../Game";
import { buildTickOverride, soundAppearanceSection } from "../../shared/appearance";
import { pickFolder } from "../../shared/modals";
import { pick, randomInt, uid } from "../../shared/random";
import { SavedSetBar, uniqueName, type SavedSetAdapter } from "../../shared/SavedSetBar";
import { chip, collapsible, relativeTime, setDisabled, setLocked } from "../../shared/ui";
import type { NoteFilter } from "../../settings";
import { FilterEditor } from "./FilterEditor";
import { folderOf } from "./NoteFilter";
import { ResultCard } from "./ResultCard";
import { SlotReel, type ReelEntry } from "./SlotReel";

const PREVIEW_CAP = 500;

function entry(f: TFile): ReelEntry {
	return { title: f.basename, folder: folderOf(f) };
}

function cloneFilter(f: NoteFilter): NoteFilter {
	return JSON.parse(JSON.stringify(f)) as NoteFilter;
}

export class NoteLotteryGame implements Game {
	id = "notes";
	name = "Note Lottery";
	icon = "ticket";

	private reel: SlotReel | null = null;
	private drawBtn: HTMLButtonElement | null = null;
	private counterEl: HTMLElement | null = null;
	private card: ResultCard | null = null;
	private bar: SavedSetBar | null = null;
	private editor: FilterEditor | null = null;
	private historyEl: HTMLElement | null = null;
	private lockables: HTMLElement[] = [];
	private range: TFile[] | null = null;
	private computing = false;
	private version = 0;
	private recountTimer: number | null = null;
	private openTimer: number | null = null;
	private events: { src: Events; ref: EventRef }[] = [];
	private busy = false;
	private alive = false;
	private lastWinner: TFile | null = null;

	constructor(private ctx: GameContext) {}

	private get d() {
		return this.ctx.plugin.data.notes;
	}

	private get service() {
		return this.ctx.plugin.notes;
	}

	mount(container: HTMLElement): void {
		this.alive = true;
		const stage = container.createDiv({ cls: "vault-lottery-reel-stage" });
		this.reel = new SlotReel(stage, () => this.play(), () => this.ctx.audio.tick(this.d.tickSoundOverride));
		this.drawBtn = stage.createEl("button", { cls: "mod-cta vault-lottery-play-btn" });
		setIcon(this.drawBtn.createSpan(), "ticket");
		this.drawBtn.createSpan({ text: "Draw a note" });
		this.drawBtn.addEventListener("click", () => this.play());
		this.counterEl = stage.createDiv({ cls: "vault-lottery-counter", text: "Counting…" });

		this.card = new ResultCard(container, this.ctx.app, {
			open: (f, tab) => void this.service.open(f, tab),
			drawAgain: () => this.play(),
			exclude: (f) => this.exclude(f),
			canDraw: () => this.canDraw(),
		});

		const barWrap = container.createDiv({ cls: "vault-lottery-block" });
		this.bar = new SavedSetBar(barWrap, this.ctx.app, this.filterAdapter());

		const editorBody = collapsible(container, "Filters", "notes-filters", false);
		this.editor = new FilterEditor(editorBody, {
			app: this.ctx.app,
			filter: () => this.d.workingFilter,
			excludedNotes: () => this.d.workingExcludedNotes,
			changed: () => this.onFilterChanged(),
			preview: () => void this.preview(),
		});

		const optionsBody = collapsible(container, "Draw options", "notes-draw-options", false);
		this.buildDrawOptions(optionsBody);

		const histBody = collapsible(container, "History", "notes-history", false);
		this.historyEl = histBody.createDiv({ cls: "vault-lottery-history" });
		this.renderHistory();

		const appearance = soundAppearanceSection(container, this.ctx.plugin, "notes", (el) => {
			new Setting(el).setName("Draw duration").setDesc("Seconds").addSlider((s) =>
				s.setLimits(2, 15, 1).setValue(this.d.drawDurationSec).setDynamicTooltip().onChange((v) => {
					this.d.drawDurationSec = v;
					this.ctx.save();
				}),
			);
			buildTickOverride(el, this.ctx.plugin, () => this.d.tickSoundOverride, (v) => (this.d.tickSoundOverride = v));
			new Setting(el).setName("Confetti").addToggle((t) =>
				t.setValue(this.d.confetti).onChange((v) => {
					this.d.confetti = v;
					this.ctx.save();
				}),
			);
			new Setting(el).setName("Auto-open after draw").addDropdown((dd) =>
				dd.addOptions({ off: "Off", current: "Current tab", tab: "New tab" }).setValue(this.d.autoOpen).onChange((v) => {
					this.d.autoOpen = v as "off";
					this.ctx.save();
				}),
			);
		});
		this.lockables = [barWrap, editorBody.parentElement as HTMLElement, optionsBody.parentElement as HTMLElement, appearance.parentElement as HTMLElement];

		const { vault, metadataCache, workspace } = this.ctx.app;
		const recount = () => this.scheduleRecount();
		this.events.push(
			{ src: vault, ref: vault.on("create", recount) },
			{ src: vault, ref: vault.on("delete", () => {
				recount();
				this.renderHistory();
			}) },
			{ src: vault, ref: vault.on("rename", () => {
				recount();
				this.renderHistory();
			}) },
			{ src: metadataCache, ref: metadataCache.on("changed", recount) },
			{ src: workspace, ref: workspace.on("active-leaf-change", () => {
				if (this.d.workingFilter.excludeActiveNote && !this.busy) recount();
			}) },
		);

		this.recount();
	}

	unmount(): void {
		this.alive = false;
		this.version++;
		for (const e of this.events) e.src.offref(e.ref);
		this.events = [];
		if (this.recountTimer !== null) window.clearTimeout(this.recountTimer);
		if (this.openTimer !== null) window.clearTimeout(this.openTimer);
		this.recountTimer = this.openTimer = null;
		this.reel?.destroy();
		this.reel = null;
		this.busy = false;
	}

	isBusy(): boolean {
		return this.busy;
	}

	refresh(): void {
		this.reel?.refresh();
	}

	private canDraw(): boolean {
		return !this.busy && !this.computing && !!this.range && this.range.length > 0;
	}

	/** How notes are picked, and what is never drawn (applies to every filter). */
	private buildDrawOptions(el: HTMLElement): void {
		el.empty();
		new Setting(el).setName("Selection mode").setDesc("Favor forgotten notes: the longer a note hasn't been modified, the more likely it is.")
			.addDropdown((dd) => dd.addOptions({ uniform: "Uniform", "favor-forgotten": "Favor forgotten notes" }).setValue(this.d.selectionMode).onChange((v) => {
				this.d.selectionMode = v as "uniform";
				this.ctx.save();
			}));
		new Setting(el).setName("Avoid the last N picks").setDesc("Recent picks are skipped when other notes are available (0–50).").addSlider((s) =>
			s.setLimits(0, 50, 1).setValue(this.d.avoidLastN).setDynamicTooltip().onChange((v) => {
				this.d.avoidLastN = v;
				this.ctx.save();
			}),
		);
		new Setting(el).setName("Exclude export files").setDesc("Never draw the plugin's own export files.").addToggle((t) =>
			t.setValue(this.d.excludeExportFiles).onChange((v) => {
				this.d.excludeExportFiles = v;
				this.ctx.save();
				this.scheduleRecount();
			}),
		);
		new Setting(el).setName("Always-excluded folders").setDesc("Applied to every filter.").addButton((b) =>
			b.setButtonText("Add folder…").onClick(async () => {
				const f = await pickFolder(this.ctx.app);
				if (!f || this.d.globalExcludedFolders.includes(f.path)) return;
				this.d.globalExcludedFolders.push(f.path);
				this.ctx.save();
				this.scheduleRecount();
				this.buildDrawOptions(el);
			}),
		);
		const chips = el.createDiv({ cls: "vault-lottery-chips" });
		if (!this.d.globalExcludedFolders.length) chips.createSpan({ cls: "vault-lottery-muted", text: "None" });
		for (const f of this.d.globalExcludedFolders) {
			chip(chips, f, () => {
				this.d.globalExcludedFolders = this.d.globalExcludedFolders.filter((x) => x !== f);
				this.ctx.save();
				this.scheduleRecount();
				this.buildDrawOptions(el);
			});
		}
	}

	private scheduleRecount(): void {
		if (this.recountTimer !== null) window.clearTimeout(this.recountTimer);
		this.recountTimer = window.setTimeout(() => {
			this.recountTimer = null;
			this.recount();
		}, 250);
	}

	private async recount(): Promise<void> {
		const v = ++this.version;
		this.computing = true;
		this.updateDrawState();
		const slow = window.setTimeout(() => {
			if (v === this.version && this.counterEl) this.counterEl.setText("Counting…");
		}, 120);
		const r = await this.service.range(
			() => v !== this.version || !this.alive,
			(done, total) => {
				if (v === this.version) this.counterEl?.setText(`Counting… ${Math.round((done / total) * 100)}%`);
			},
		);
		window.clearTimeout(slow);
		if (!r || v !== this.version || !this.alive) return;
		this.range = r.files;
		this.computing = false;
		const n = r.files.length;
		this.counterEl?.setText(`${n.toLocaleString()} ${n === 1 ? "note" : "notes"} in range`);
		this.updateDrawState();
		if (!this.busy) this.showIdle();
	}

	private showIdle(): void {
		const r = this.range ?? [];
		if (!r.length) {
			this.reel?.setIdle(null, [], "No notes match your filters");
			return;
		}
		const center = this.lastWinner && r.includes(this.lastWinner) ? this.lastWinner : pick(r);
		this.reel?.setIdle(entry(center), [entry(pick(r)), entry(pick(r))]);
	}

	private updateDrawState(): void {
		const empty = !this.computing && (!this.range || this.range.length === 0);
		setDisabled(this.drawBtn, this.busy || this.computing || empty, empty ? "No notes match your filters" : "");
		this.card?.updateDrawState();
	}

	private onFilterChanged(): void {
		this.ctx.save();
		this.bar?.update();
		this.scheduleRecount();
	}

	private setBusy(b: boolean): void {
		this.busy = b;
		for (const el of this.lockables) setLocked(el, b);
		this.updateDrawState();
		this.ctx.busyChanged();
	}

	play(): void {
		if (!this.canDraw() || !this.reel || !this.range) return;
		const range = this.range;
		const winner = this.service.choose(range);
		if (!winner) return;
		if (this.openTimer !== null) window.clearTimeout(this.openTimer);
		const len = randomInt(30, 60);
		const strip: ReelEntry[] = [];
		strip.push(this.reel.center ?? entry(pick(range)));
		for (let i = 1; i < len; i++) strip.push(entry(pick(range)));
		strip.push(entry(winner));
		const winnerIndex = strip.length - 1;
		strip.push(entry(pick(range)), entry(pick(range)));
		this.setBusy(true);
		this.card?.clear();
		this.ctx.audio.gameStart();
		void this.reel.spin(strip, this.d.drawDurationSec * 1000, winnerIndex).then(() => this.finish(winner));
	}

	private finish(file: TFile): void {
		if (!this.alive) return;
		this.lastWinner = file;
		this.service.record(file);
		this.reel?.setWin(true);
		this.ctx.audio.gameEnd();
		this.setBusy(false);
		this.ctx.announce(`Picked note: ${file.basename}`);
		if (this.d.confetti && this.reel) this.ctx.celebrate(this.reel.frame, undefined, this.reel.frame);
		void this.card?.show(file);
		this.renderHistory();
		if (this.d.autoOpen !== "off") {
			const tab = this.d.autoOpen === "tab";
			this.openTimer = window.setTimeout(() => {
				this.openTimer = null;
				void this.service.open(file, tab);
			}, 800);
		}
	}

	private exclude(file: TFile): void {
		if (!this.d.workingExcludedNotes.includes(file.path)) this.d.workingExcludedNotes.push(file.path);
		this.card?.clear();
		this.editor?.render();
		this.onFilterChanged();
	}

	private renderHistory(): void {
		const el = this.historyEl;
		if (!el) return;
		el.empty();
		const h = this.d.history.slice(0, 10);
		if (!h.length) {
			el.createDiv({ cls: "vault-lottery-muted", text: "No picks yet." });
			return;
		}
		const list = el.createEl("ul", { cls: "vault-lottery-history-list" });
		for (const item of h) {
			const li = list.createEl("li");
			const a = li.createEl("a", { href: "#", text: item.path.replace(/\.md$/, "").split("/").pop() ?? item.path, attr: { dir: "auto" } });
			a.setAttr("title", item.path);
			a.addEventListener("click", (e) => {
				e.preventDefault();
				const f = this.ctx.app.vault.getAbstractFileByPath(item.path);
				if (f instanceof TFile) void this.service.open(f, e.ctrlKey || e.metaKey);
			});
			li.createSpan({ cls: "vault-lottery-muted", text: relativeTime(item.pickedAt) });
		}
		const clear = el.createEl("button", { text: "Clear history", cls: "mod-muted" });
		clear.addEventListener("click", () => {
			this.service.clearHistory();
			this.renderHistory();
		});
	}

	private async preview(): Promise<void> {
		const r = await this.service.range();
		if (!r) return;
		new RangePreviewModal(this.ctx, r.files, (f) => void this.service.open(f, false)).open();
	}

	/** Called by the "Draw with filter…" command. */
	loadFilterAndDraw(id: string): void {
		if (this.busy) return;
		const a = this.filterAdapter();
		a.load(id);
		this.bar?.update();
		this.editor?.render();
		void this.recount().then(() => this.play());
	}

	/** Draw once the range is ready (used by commands right after opening the view). */
	drawWhenReady(): void {
		if (this.canDraw()) {
			this.play();
			return;
		}
		let tries = 0;
		const wait = () => {
			if (!this.alive) return;
			if (this.canDraw()) this.play();
			else if (tries++ < 100) window.setTimeout(wait, 100);
		};
		wait();
	}

	private filterAdapter(): SavedSetAdapter {
		const d = this.d;
		const loaded = () => d.savedFilters.find((f) => f.id === d.loadedFilterId);
		return {
			noun: "filter",
			items: () => d.savedFilters,
			loadedId: () => d.loadedFilterId,
			isDirty: () => {
				const l = loaded();
				if (!l) return false;
				return JSON.stringify(l.filter) !== JSON.stringify(d.workingFilter) ||
					JSON.stringify(l.excludedNotes) !== JSON.stringify(d.workingExcludedNotes);
			},
			load: (id) => {
				const f = d.savedFilters.find((x) => x.id === id);
				if (!f) return;
				d.workingFilter = cloneFilter(f.filter);
				d.workingExcludedNotes = f.excludedNotes.slice();
				d.loadedFilterId = id;
				this.ctx.save();
				this.editor?.render();
				this.scheduleRecount();
			},
			save: () => {
				const l = loaded();
				if (!l) return;
				l.filter = cloneFilter(d.workingFilter);
				l.excludedNotes = d.workingExcludedNotes.slice();
				this.ctx.save();
				this.bar?.update();
			},
			saveAs: (name) => {
				const f = {
					id: uid(),
					name: uniqueName(name, d.savedFilters.map((x) => x.name)),
					filter: cloneFilter(d.workingFilter),
					excludedNotes: d.workingExcludedNotes.slice(),
				};
				d.savedFilters.push(f);
				d.loadedFilterId = f.id;
				this.ctx.save();
			},
			rename: (id, name) => {
				const f = d.savedFilters.find((x) => x.id === id);
				if (!f) return;
				f.name = uniqueName(name, d.savedFilters.filter((x) => x.id !== id).map((x) => x.name));
				this.ctx.save();
			},
			remove: (id) => {
				d.savedFilters = d.savedFilters.filter((x) => x.id !== id);
				if (d.loadedFilterId === id) {
					d.loadedFilterId = null;
				}
				this.ctx.save();
			},
		};
	}
}

class RangePreviewModal extends Modal {
	constructor(ctx: GameContext, private files: TFile[], private onOpenFile: (f: TFile) => void) {
		super(ctx.app);
	}

	onOpen(): void {
		this.titleEl.setText(`Notes in range (${this.files.length.toLocaleString()})`);
		this.contentEl.addClass("vault-lottery-modal");
		const list = this.contentEl.createDiv({ cls: "vault-lottery-preview-list" });
		if (!this.files.length) list.createDiv({ cls: "vault-lottery-muted", text: "No notes match your filters." });
		const sorted = this.files.slice().sort((a, b) => a.path.localeCompare(b.path));
		for (const f of sorted.slice(0, PREVIEW_CAP)) {
			const row = list.createDiv({ cls: "vault-lottery-preview-row" });
			const a = row.createEl("a", { href: "#", text: f.basename, attr: { dir: "auto" } });
			a.addEventListener("click", (e) => {
				e.preventDefault();
				this.close();
				this.onOpenFile(f);
			});
			const folder = folderOf(f);
			if (folder) row.createSpan({ cls: "vault-lottery-muted", text: folder, attr: { dir: "auto" } });
		}
		if (sorted.length > PREVIEW_CAP) {
			list.createDiv({ cls: "vault-lottery-muted vault-lottery-more", text: `+${(sorted.length - PREVIEW_CAP).toLocaleString()} more` });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
