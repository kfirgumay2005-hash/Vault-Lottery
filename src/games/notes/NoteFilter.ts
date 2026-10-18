// Filter model + matching. Uses only metadataCache and TFile.stat, except the word-count rule (lazy, cached).

import { App, TFile, getAllTags } from "obsidian";
import type { FilterRule, NoteFilter } from "../../settings";

export const EXPORT_PREFIX = "Vault Lottery Export";

const DAY = 86400000;

export function ruleOn(f: NoteFilter, rule: FilterRule): boolean {
	return !f.disabledRules.includes(rule);
}

function inFolder(path: string, folder: string): boolean {
	const f = folder.replace(/^\/+|\/+$/g, "");
	if (!f) return true;
	return path === f || path.startsWith(f + "/");
}

function normTag(t: string): string {
	return t.replace(/^#/, "").toLowerCase();
}

/** #project matches #project and #project/anything. */
function tagMatches(fileTags: string[], wanted: string): boolean {
	const w = normTag(wanted);
	if (!w) return false;
	return fileTags.some((t) => t === w || t.startsWith(w + "/"));
}

export function fileTags(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return [];
	return (getAllTags(cache) ?? []).map(normTag);
}

function propertyValues(v: unknown): string[] {
	if (v === null || v === undefined) return [];
	if (Array.isArray(v)) return v.flatMap(propertyValues);
	if (typeof v === "object") return [JSON.stringify(v)];
	return [String(v)];
}

export interface MatchContext {
	app: App;
	activePath: string | null;
	globalExcludedFolders: string[];
	excludeExportFiles: boolean;
	excludedNotes: Set<string>;
	now: number;
}

/** Everything except the word-count rule. */
export function matchesSync(file: TFile, f: NoteFilter, m: MatchContext): boolean {
	const path = file.path;
	if (m.excludedNotes.has(path)) return false;
	if (f.excludeActiveNote && m.activePath === path) return false;
	if (m.excludeExportFiles && file.basename.startsWith(EXPORT_PREFIX)) return false;
	for (const g of m.globalExcludedFolders) if (g && inFolder(path, g)) return false;

	if (ruleOn(f, "excludeFolders")) {
		for (const ex of f.excludeFolders) if (inFolder(path, ex)) return false;
	}
	if (ruleOn(f, "includeFolders") && f.includeFolders.length > 0) {
		if (!f.includeFolders.some((inc) => inFolder(path, inc))) return false;
	}
	if (ruleOn(f, "nameContains") && f.nameContains && f.nameContains.trim()) {
		if (!file.basename.toLowerCase().includes(f.nameContains.trim().toLowerCase())) return false;
	}
	if (ruleOn(f, "modified") && f.modified && f.modified.days > 0) {
		const age = m.now - file.stat.mtime;
		if (f.modified.op === "within" ? age > f.modified.days * DAY : age < f.modified.days * DAY) return false;
	}
	if (ruleOn(f, "created") && f.created && f.created.days > 0) {
		const age = m.now - file.stat.ctime;
		if (f.created.op === "within" ? age > f.created.days * DAY : age < f.created.days * DAY) return false;
	}

	const needTags = (ruleOn(f, "includeTags") && f.includeTags.length > 0) || (ruleOn(f, "excludeTags") && f.excludeTags.length > 0);
	if (needTags) {
		const tags = fileTags(m.app, file);
		if (ruleOn(f, "excludeTags") && f.excludeTags.some((t) => tagMatches(tags, t))) return false;
		if (ruleOn(f, "includeTags") && f.includeTags.length > 0) {
			const ok = f.includeTagsMode === "all"
				? f.includeTags.every((t) => tagMatches(tags, t))
				: f.includeTags.some((t) => tagMatches(tags, t));
			if (!ok) return false;
		}
	}

	if (ruleOn(f, "property") && f.property && f.property.key.trim()) {
		const fm = m.app.metadataCache.getFileCache(file)?.frontmatter;
		const key = f.property.key.trim();
		// Property keys are case-insensitive in Obsidian
		const actualKey = fm ? Object.keys(fm).find((k) => k.toLowerCase() === key.toLowerCase()) : undefined;
		const exists = actualKey !== undefined && fm?.[actualKey] !== null && fm?.[actualKey] !== undefined && fm?.[actualKey] !== "";
		const values = actualKey !== undefined && fm ? propertyValues(fm[actualKey]).map((s) => s.toLowerCase()) : [];
		const want = (f.property.value ?? "").trim().toLowerCase();
		switch (f.property.op) {
			case "exists":
				if (!exists) return false;
				break;
			case "not-exists":
				if (exists) return false;
				break;
			case "equals":
				if (!values.some((v) => v === want || v.replace(/^\[\[|\]\]$/g, "") === want)) return false;
				break;
			case "contains":
				if (!values.some((v) => v.includes(want))) return false;
				break;
		}
	}
	return true;
}

/** Word counts cached by path + mtime. */
export class WordCountCache {
	private cache = new Map<string, { mtime: number; words: number }>();

	get(file: TFile): number | undefined {
		const c = this.cache.get(file.path);
		return c && c.mtime === file.stat.mtime ? c.words : undefined;
	}

	async count(app: App, file: TFile): Promise<number> {
		const hit = this.get(file);
		if (hit !== undefined) return hit;
		const text = await app.vault.cachedRead(file);
		const words = countWords(stripFrontmatter(text));
		this.cache.set(file.path, { mtime: file.stat.mtime, words });
		return words;
	}

	rename(oldPath: string, newPath: string): void {
		const c = this.cache.get(oldPath);
		if (c) {
			this.cache.delete(oldPath);
			this.cache.set(newPath, c);
		}
	}
}

export function stripFrontmatter(text: string): string {
	if (!text.startsWith("---")) return text;
	const m = text.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
	return m ? text.slice(m[0].length) : text;
}

export function countWords(text: string): number {
	const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
	return m ? m.length : 0;
}

export interface RangeResult {
	files: TFile[];
	/** True when the word-count rule had to read files (shows "Counting…" meanwhile). */
	counted: boolean;
}

/**
 * The notes in range. `isCancelled` lets a newer computation abort an older one.
 * Word counting yields to the UI every chunk so 10,000+ note vaults stay responsive.
 */
export async function computeRange(
	f: NoteFilter,
	m: MatchContext,
	words: WordCountCache,
	isCancelled: () => boolean,
	onProgress?: (done: number, total: number) => void,
): Promise<RangeResult | null> {
	const all = m.app.vault.getMarkdownFiles();
	const pre = all.filter((file) => matchesSync(file, f, m));
	const min = ruleOn(f, "minWords") && f.minWords && f.minWords > 0 ? f.minWords : 0;
	if (!min) return { files: pre, counted: false };
	const out: TFile[] = [];
	// Yield to the UI after ~12 ms of work (not after a fixed count: cached counts are nearly free).
	let sliceStart = performance.now();
	const BATCH = 64;
	for (let i = 0; i < pre.length; i++) {
		const file = pre[i];
		let n = words.get(file);
		if (n === undefined) {
			// Read the next uncached files in parallel, then continue from the cache
			const batch = pre.slice(i, i + BATCH).filter((f) => words.get(f) === undefined);
			await Promise.all(batch.map((f) => words.count(m.app, f).catch(() => 0)));
			n = words.get(file) ?? 0;
		}
		if (n >= min) out.push(file);
		if (performance.now() - sliceStart > 12) {
			if (isCancelled()) return null;
			onProgress?.(i + 1, pre.length);
			await new Promise((r) => window.setTimeout(r, 0));
			sliceStart = performance.now();
		}
	}
	if (isCancelled()) return null;
	return { files: out, counted: true };
}

export function folderOf(file: TFile): string {
	const p = file.parent?.path ?? "";
	return p === "/" ? "" : p;
}

/** Plain-text excerpt (frontmatter stripped, Markdown lightly stripped). */
export function excerpt(text: string, max = 200): string {
	let t = stripFrontmatter(text);
	t = t
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/%%[\s\S]*?%%/g, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/!\[\[[^\]]*\]\]/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s*>\s?(\[![^\]]*\][+-]?)?/gm, "")
		.replace(/^\s*[-*+]\s+\[.\]\s+/gm, "")
		.replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
		.replace(/(\*\*|__|==|~~)/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + "…";
	return t;
}
