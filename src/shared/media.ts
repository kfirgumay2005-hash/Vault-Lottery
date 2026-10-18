// Sound files and background videos live in the vault, in the folder Obsidian uses for new attachments
// (Settings → Files and links → Default location for new attachments).

import { App, TFile, normalizePath } from "obsidian";

/** Saves data as a new file in the attachment folder (with a free name) and returns it. */
export async function saveAttachment(app: App, data: ArrayBuffer, name: string): Promise<TFile> {
	const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "file";
	const source = app.workspace.getActiveFile()?.path ?? "";
	const fm = app.fileManager as { getAvailablePathForAttachment?: (n: string, s?: string) => Promise<string> };
	let path = typeof fm.getAvailablePathForAttachment === "function"
		? await fm.getAvailablePathForAttachment(clean, source)
		: normalizePath(clean);
	path = normalizePath(path);
	const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
	if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir).catch(() => undefined);
	return app.vault.createBinary(path, data);
}

/** Resource URL of a vault file (for <audio> / <video>). */
export function vaultUrl(app: App, path: string): string {
	const f = app.vault.getAbstractFileByPath(path);
	return f instanceof TFile ? app.vault.getResourcePath(f) : app.vault.adapter.getResourcePath(normalizePath(path));
}
