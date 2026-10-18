// Copy / insert-at-cursor helpers.

import { App, Editor, MarkdownView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";

export async function copyText(text: string, notice = "Copied to clipboard"): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		if (notice) new Notice(notice);
		return true;
	} catch {
		new Notice("Could not copy to the clipboard.");
		return false;
	}
}

/** Inserts at the cursor, on its own line when the cursor isn't at the start of an empty line. */
export function insertAtCursor(editor: Editor, text: string, block = false): void {
	if (!block) {
		editor.replaceSelection(text);
		return;
	}
	const cur = editor.getCursor();
	const line = editor.getLine(cur.line);
	let t = text;
	if (line.trim().length > 0) {
		editor.setCursor({ line: cur.line, ch: line.length });
		t = "\n" + t;
	}
	if (!t.endsWith("\n")) t += "\n";
	editor.replaceSelection(t);
}

/** Tracks the most recently active Markdown editor (the sidebar view itself is never one). */
export class EditorTracker {
	private last: MarkdownView | null = null;

	constructor(private app: App) {}

	onLeafChange(leaf: WorkspaceLeaf | null): void {
		const v = leaf?.view;
		if (v instanceof MarkdownView) this.last = v;
	}

	view(): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;
		const v = this.last;
		if (v && v.file && this.app.workspace.getLeavesOfType("markdown").some((l) => l.view === v)) return v;
		this.last = null;
		return null;
	}

	/** Inserts into the last editor, or copies with a Notice when there is none. */
	async insertOrCopy(text: string, block: boolean): Promise<void> {
		const v = this.view();
		if (v && v.getMode() === "source") {
			insertAtCursor(v.editor, text, block);
			new Notice(`Inserted into ${v.file?.basename ?? "note"}`);
			return;
		}
		await copyText(text, "No open editor — copied to the clipboard instead");
	}
}

export function timestamp(d = new Date()): { date: string; time: string } {
	const p = (n: number) => String(n).padStart(2, "0");
	return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}${p(d.getMinutes())}` };
}

/** Creates a note, adding " (2)" etc. when the name is taken. */
export async function createUniqueNote(app: App, folder: string, base: string, content: string, ext = "md"): Promise<TFile> {
	const dir = folder.trim().replace(/^\/+|\/+$/g, "");
	if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
	let i = 1;
	let path = normalizePath(`${dir ? dir + "/" : ""}${base}.${ext}`);
	while (app.vault.getAbstractFileByPath(path)) {
		i++;
		path = normalizePath(`${dir ? dir + "/" : ""}${base} (${i}).${ext}`);
	}
	return app.vault.create(path, content);
}
