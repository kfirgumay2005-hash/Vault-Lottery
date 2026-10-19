// Finds out whether a vault file is used anywhere: linked or embedded from a note, mentioned in a note or canvas
// (HTML tags, frontmatter, plain paths), or named in the settings / data of Obsidian or any plugin.

import { App, TFile, TFolder, normalizePath } from "obsidian";

interface Source {
	label: string;
	text: string;
}

export class MediaUsage {
	private constructor(
		private links: Map<string, string[]>,
		private sources: Source[],
	) {}

	/**
	 * Reads the vault once. `own` is this plugin's live data (newer than its data.json on disk), listed as
	 * `ownLabel`; pass null to leave it out.
	 */
	static async build(app: App, ownDir: string, own: { label: string; json: string } | null): Promise<MediaUsage> {
		const links = new Map<string, string[]>();
		for (const [from, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
			for (const to of Object.keys(targets)) {
				const list = links.get(to);
				if (list) list.push(from);
				else links.set(to, [from]);
			}
		}
		const sources: Source[] = [];
		for (const f of app.vault.getFiles()) {
			if (f.extension !== "md" && f.extension !== "canvas") continue;
			try {
				sources.push({ label: f.path, text: await app.vault.cachedRead(f) });
			} catch {
				/* unreadable: skip */
			}
		}
		// Obsidian's own settings, snippets, and every plugin's data (other plugins may point at media too)
		const adapter = app.vault.adapter;
		const config = app.vault.configDir;
		const readAll = async (dir: string, exts: string[], label: (path: string) => string) => {
			try {
				if (!(await adapter.exists(dir))) return;
				const list = await adapter.list(dir);
				for (const p of list.files) {
					if (!exts.some((e) => p.toLowerCase().endsWith(e))) continue;
					// The workspace only remembers recently opened files: that isn't "using" them
					if (/\/workspace(-mobile)?\.json$/.test(p)) continue;
					sources.push({ label: label(p), text: await adapter.read(p) });
				}
			} catch {
				/* ignore */
			}
		};
		await readAll(config, [".json"], (p) => `Obsidian settings (${p.split("/").pop()})`);
		await readAll(`${config}/snippets`, [".css"], (p) => `CSS snippet ${p.split("/").pop()}`);
		try {
			const plugins = await adapter.list(`${config}/plugins`);
			for (const dir of plugins.folders) {
				if (normalizePath(dir) === normalizePath(ownDir)) continue;
				await readAll(dir, ["data.json"], () => `Plugin "${dir.split("/").pop()}"`);
			}
		} catch {
			/* no plugins folder */
		}
		if (own) sources.push({ label: own.label, text: own.json });
		return new MediaUsage(links, sources);
	}

	/** Where the file is used (empty = unused). */
	usedBy(file: TFile, max = 5): string[] {
		const out = new Set<string>(this.links.get(file.path) ?? []);
		const needles = Array.from(new Set([file.path, file.name, encodeURI(file.name), encodeURI(file.path)]));
		for (const s of this.sources) {
			if (out.size >= max) break;
			if (needles.some((n) => s.text.includes(n))) out.add(s.label);
		}
		return Array.from(out).slice(0, max);
	}
}

/**
 * The fixed folder new attachments go to, or null when Obsidian puts them next to each note / in the vault root.
 */
export function attachmentFolder(app: App): TFolder | null {
	const v = (app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.("attachmentFolderPath");
	if (typeof v !== "string" || !v || v === "/" || v === "." || v.startsWith("./")) return null;
	const f = app.vault.getAbstractFileByPath(normalizePath(v));
	return f instanceof TFolder ? f : null;
}

/** All files in a folder and its subfolders. */
export function filesIn(folder: TFolder): TFile[] {
	const out: TFile[] = [];
	const walk = (f: TFolder) => {
		for (const c of f.children) {
			if (c instanceof TFile) out.push(c);
			else if (c instanceof TFolder) walk(c);
		}
	};
	walk(folder);
	return out;
}

/**
 * Removes a file: to the trash the way the user set it up (system trash or .trash), or — when the user chose
 * "Delete permanently" in the plugin settings — straight off the disk to free the space.
 */
export async function removeFile(app: App, file: TFile, permanent: boolean): Promise<void> {
	if (permanent) await app.vault.adapter.remove(file.path);
	else await app.fileManager.trashFile(file);
}
