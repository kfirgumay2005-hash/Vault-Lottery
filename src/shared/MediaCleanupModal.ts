// "Find unused media": lists the files in the media folder, split into unused and used (with where they are used),
// and lets the user move unused ones to the trash, picked one by one or all at once.

import { App, Modal, Notice, TFile, TFolder, setIcon } from "obsidian";
import { MediaUsage, filesIn, removeFile } from "./mediaUsage";
import { confirm } from "./modals";

const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "webm"];
const VIDEO_EXT = ["mp4", "m4v", "mov", "mkv", "webm", "ogv"];

function iconFor(f: TFile): string {
	const e = f.extension.toLowerCase();
	if (VIDEO_EXT.includes(e) && e !== "webm") return "film";
	if (AUDIO_EXT.includes(e)) return "music";
	if (e === "pdf") return "file-text";
	return "file";
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export class MediaCleanupModal extends Modal {
	private selected = new Set<string>();
	private unused: TFile[] = [];
	private used: { file: TFile; by: string[] }[] = [];
	private busy = false;

	constructor(
		app: App,
		private folder: TFolder,
		/** Delete for good instead of moving to the trash (plugin setting). */
		private permanent: () => boolean,
		private scan: () => Promise<MediaUsage>,
		private onDeleted: (paths: string[]) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("vault-lottery-media-modal");
		this.contentEl.addClass("vault-lottery-modal");
		this.titleEl.setText("Unused media");
		void this.refresh();
	}

	private async refresh(): Promise<void> {
		const el = this.contentEl;
		el.empty();
		el.createDiv({ cls: "vault-lottery-muted", text: `Scanning the vault for files in "${this.folder.path}"…` });
		const usage = await this.scan();
		this.unused = [];
		this.used = [];
		for (const f of filesIn(this.folder).sort((a, b) => a.path.localeCompare(b.path))) {
			if (f.extension === "md" || f.extension === "canvas") continue;
			const by = usage.usedBy(f);
			if (by.length) this.used.push({ file: f, by });
			else this.unused.push(f);
		}
		this.selected = new Set([...this.selected].filter((p) => this.unused.some((f) => f.path === p)));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const total = this.unused.length + this.used.length;
		const unusedSize = this.unused.reduce((s, f) => s + f.stat.size, 0);
		el.createDiv({
			cls: "vault-lottery-media-summary",
			text: `${total} files in "${this.folder.path}" — ${this.unused.length} unused (${formatSize(unusedSize)}), ${this.used.length} used.`,
		});

		// ---- Unused ----
		const head = el.createDiv({ cls: "vault-lottery-media-head" });
		head.createEl("h3", { text: "Not used anywhere" });
		if (this.unused.length) {
			const all = head.createEl("button", { cls: "mod-muted vault-lottery-small-btn" });
			const allOn = this.selected.size === this.unused.length;
			all.setText(allOn ? "Select none" : "Select all");
			all.addEventListener("click", () => {
				this.selected = allOn ? new Set() : new Set(this.unused.map((f) => f.path));
				this.render();
			});
		}
		const list = el.createDiv({ cls: "vault-lottery-media-list" });
		if (!this.unused.length) list.createDiv({ cls: "vault-lottery-muted", text: "Every file in the folder is used. Nothing to clean up." });
		for (const f of this.unused) {
			const row = list.createEl("label", { cls: "vault-lottery-media-row" });
			const cb = row.createEl("input", { type: "checkbox" });
			cb.checked = this.selected.has(f.path);
			cb.addEventListener("change", () => {
				if (cb.checked) this.selected.add(f.path);
				else this.selected.delete(f.path);
				this.updateButtons();
			});
			this.fileCell(row, f);
		}

		// ---- Used ----
		if (this.used.length) {
			const det = el.createEl("details", { cls: "vault-lottery-media-used" });
			det.createEl("summary", { text: `Used (${this.used.length})` });
			const ul = det.createDiv({ cls: "vault-lottery-media-list" });
			for (const u of this.used) {
				const row = ul.createDiv({ cls: "vault-lottery-media-row is-used" });
				const info = this.fileCell(row, u.file);
				info.createDiv({ cls: "vault-lottery-muted vault-lottery-small", text: `Used by: ${u.by.join(", ")}` });
			}
		}

		// ---- Actions ----
		const actions = el.createDiv({ cls: "vault-lottery-media-actions" });
		const rescan = actions.createEl("button", { text: "Scan again" });
		rescan.addEventListener("click", () => void this.refresh());
		actions.createDiv({ cls: "vault-lottery-spacer" });
		const delSel = actions.createEl("button", { cls: "mod-warning vault-lottery-del-selected" });
		delSel.addEventListener("click", () => void this.remove(this.unused.filter((f) => this.selected.has(f.path))));
		const delAll = actions.createEl("button", { cls: "mod-warning", text: `Delete all unused (${this.unused.length})` });
		delAll.disabled = !this.unused.length || this.busy;
		delAll.addEventListener("click", () => void this.remove(this.unused));
		this.updateButtons();
	}

	/** Thumbnail / icon + name, folder and size. Returns the text column. */
	private fileCell(row: HTMLElement, f: TFile): HTMLElement {
		const thumb = row.createDiv({ cls: "vault-lottery-media-thumb" });
		if (IMAGE_EXT.includes(f.extension.toLowerCase())) {
			const img = thumb.createEl("img", { attr: { loading: "lazy", alt: "" } });
			img.src = this.app.vault.getResourcePath(f);
		} else {
			setIcon(thumb, iconFor(f));
		}
		const info = row.createDiv({ cls: "vault-lottery-media-info" });
		info.createDiv({ cls: "vault-lottery-media-name", text: f.name, attr: { dir: "auto" } });
		const rel = f.parent && f.parent.path !== this.folder.path ? `${f.parent.path} · ` : "";
		info.createDiv({ cls: "vault-lottery-muted vault-lottery-small", text: `${rel}${formatSize(f.stat.size)}` });
		return info;
	}

	private updateButtons(): void {
		const b = this.contentEl.querySelector<HTMLButtonElement>(".vault-lottery-del-selected");
		if (!b) return;
		b.setText(`Delete selected (${this.selected.size})`);
		b.disabled = this.selected.size === 0 || this.busy;
	}

	private async remove(files: TFile[]): Promise<void> {
		if (!files.length || this.busy) return;
		const permanent = this.permanent();
		const what = files.length === 1 ? `"${files[0].name}"` : `${files.length} files`;
		const ok = await confirm(
			this.app,
			permanent ? `Delete ${what} for good?` : `Delete ${what}?`,
			permanent
				? "They are deleted permanently to free the space. This can't be undone."
				: "They are moved to the trash (as set in Settings → Files and links), so you can still get them back.",
			"Delete",
			true,
		);
		if (!ok) return;
		this.busy = true;
		const done: string[] = [];
		for (const f of files) {
			try {
				await removeFile(this.app, f, permanent);
				done.push(f.path);
			} catch (e) {
				console.error("Vault Lottery: could not delete", f.path, e);
			}
		}
		this.busy = false;
		this.onDeleted(done);
		new Notice(done.length === files.length ? `Deleted ${done.length} file${done.length === 1 ? "" : "s"}.` : `Deleted ${done.length} of ${files.length} files.`);
		for (const p of done) this.selected.delete(p);
		await this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
