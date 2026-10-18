// Note Lottery logic shared by the game and the commands: range, selection, history, opening.

import { TFile, type WorkspaceLeaf } from "obsidian";
import type VaultLotteryPlugin from "../../main";
import { pick, weightedPick } from "../../shared/random";
import { WordCountCache, computeRange, type MatchContext, type RangeResult } from "./NoteFilter";

const DAY = 86400000;
const HISTORY_MAX = 50;

export class NoteService {
	readonly words = new WordCountCache();

	constructor(private plugin: VaultLotteryPlugin) {}

	private get d() {
		return this.plugin.data.notes;
	}

	/** The note open in the main area (the sidebar view is never "active note" here). */
	activeFile(): TFile | null {
		const ws = this.plugin.app.workspace;
		const leaf = ws.getMostRecentLeaf(ws.rootSplit);
		const f = (leaf?.view as { file?: TFile } | undefined)?.file;
		return f instanceof TFile ? f : null;
	}

	matchContext(): MatchContext {
		return {
			app: this.plugin.app,
			activePath: this.activeFile()?.path ?? null,
			globalExcludedFolders: this.d.globalExcludedFolders,
			excludeExportFiles: this.d.excludeExportFiles,
			excludedNotes: new Set(this.d.workingExcludedNotes),
			now: Date.now(),
		};
	}

	range(isCancelled: () => boolean = () => false, onProgress?: (done: number, total: number) => void): Promise<RangeResult | null> {
		return computeRange(this.d.workingFilter, this.matchContext(), this.words, isCancelled, onProgress);
	}

	/** Chooses the winner: avoid-last-N (when possible) and the selection mode. */
	choose(files: TFile[]): TFile | null {
		if (!files.length) return null;
		let pool = files;
		const n = this.d.avoidLastN;
		if (n > 0 && this.d.history.length) {
			const recent = new Set(this.d.history.slice(0, n).map((h) => h.path));
			const filtered = files.filter((f) => !recent.has(f.path));
			if (filtered.length) pool = filtered;
		}
		if (this.d.selectionMode === "favor-forgotten") {
			const now = Date.now();
			return weightedPick(pool, (f) => Math.max(1, (now - f.stat.mtime) / DAY));
		}
		return pick(pool);
	}

	record(file: TFile): void {
		const h = this.d.history.filter((x) => x.path !== file.path);
		h.unshift({ path: file.path, pickedAt: Date.now() });
		this.d.history = h.slice(0, HISTORY_MAX);
		this.plugin.saveSoon();
	}

	clearHistory(): void {
		this.d.history = [];
		this.plugin.saveSoon();
	}

	onRename(oldPath: string, newPath: string): boolean {
		let changed = false;
		for (const h of this.d.history) {
			if (h.path === oldPath) {
				h.path = newPath;
				changed = true;
			}
		}
		const lists = [this.d.workingExcludedNotes, ...this.d.savedFilters.map((f) => f.excludedNotes)];
		for (const list of lists) {
			const i = list.indexOf(oldPath);
			if (i >= 0) {
				list[i] = newPath;
				changed = true;
			}
		}
		this.words.rename(oldPath, newPath);
		if (changed) this.plugin.saveSoon();
		return changed;
	}

	onDelete(path: string): boolean {
		const before = this.d.history.length;
		this.d.history = this.d.history.filter((h) => h.path !== path);
		const changed = before !== this.d.history.length;
		if (changed) this.plugin.saveSoon();
		return changed;
	}

	/** Opens in the main area — current/most recent tab or a new tab — never in the sidebar leaf. */
	async open(file: TFile, newTab: boolean): Promise<void> {
		const ws = this.plugin.app.workspace;
		const recent = ws.getMostRecentLeaf(ws.rootSplit);
		let leaf: WorkspaceLeaf;
		if (recent && recent.getRoot() === ws.rootSplit) {
			if (newTab) {
				ws.setActiveLeaf(recent, { focus: false });
				leaf = ws.getLeaf("tab");
				if (leaf.getRoot() !== ws.rootSplit) leaf = ws.createLeafInParent(ws.rootSplit, 0);
			} else {
				leaf = recent;
			}
		} else {
			leaf = ws.createLeafInParent(ws.rootSplit, 0);
		}
		await leaf.openFile(file);
		ws.setActiveLeaf(leaf, { focus: true });
		await ws.revealLeaf(leaf);
	}

	/** Command: open a random note from the current filter without animation. */
	async openRandom(): Promise<TFile | null> {
		const r = await this.range();
		const file = r ? this.choose(r.files) : null;
		if (!file) return null;
		this.record(file);
		await this.open(file, this.d.autoOpen === "tab");
		return file;
	}
}
