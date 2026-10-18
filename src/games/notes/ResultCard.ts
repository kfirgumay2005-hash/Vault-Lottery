// Result card for the picked note: title, folder, tags, date, plain-text excerpt and actions.

import { App, Keymap, Menu, TFile, setIcon } from "obsidian";
import { copyText } from "../../shared/insertResult";
import { excerpt, fileTags, folderOf } from "./NoteFilter";

export interface ResultCardActions {
	open(file: TFile, newTab: boolean): void;
	drawAgain(): void;
	exclude(file: TFile): void;
	canDraw(): boolean;
}

export function revealInExplorer(app: App, file: TFile): boolean {
	const fe = (app as unknown as { internalPlugins?: { getEnabledPluginById?: (id: string) => unknown } })
		.internalPlugins?.getEnabledPluginById?.("file-explorer") as { revealInFolder?: (f: TFile) => void } | undefined;
	if (!fe?.revealInFolder) return false;
	fe.revealInFolder(file);
	return true;
}

export function hasFileExplorer(app: App): boolean {
	const fe = (app as unknown as { internalPlugins?: { getEnabledPluginById?: (id: string) => unknown } })
		.internalPlugins?.getEnabledPluginById?.("file-explorer") as { revealInFolder?: unknown } | undefined;
	return typeof fe?.revealInFolder === "function";
}

export class ResultCard {
	readonly el: HTMLElement;
	private againBtn: HTMLButtonElement | null = null;

	constructor(parent: HTMLElement, private app: App, private actions: ResultCardActions) {
		this.el = parent.createDiv({ cls: "vault-lottery-result-card" });
		this.el.hide();
	}

	clear(): void {
		this.el.empty();
		this.el.hide();
	}

	updateDrawState(): void {
		if (this.againBtn) this.againBtn.disabled = !this.actions.canDraw();
	}

	async show(file: TFile): Promise<void> {
		const el = this.el;
		el.empty();
		el.show();
		el.removeClass("is-pop");
		void el.offsetWidth;
		el.addClass("is-pop");

		const title = el.createEl("a", { cls: "vault-lottery-card-title", text: file.basename, attr: { href: "#", dir: "auto" } });
		title.addEventListener("click", (e) => {
			e.preventDefault();
			this.actions.open(file, Keymap.isModEvent(e) !== false);
		});
		title.addEventListener("auxclick", (e) => {
			if (e.button === 1) {
				e.preventDefault();
				this.actions.open(file, true);
			}
		});
		const folder = folderOf(file);
		const meta = el.createDiv({ cls: "vault-lottery-card-meta" });
		const fo = meta.createSpan({ cls: "vault-lottery-card-folder" });
		setIcon(fo.createSpan(), "folder");
		fo.createSpan({ text: folder || "Vault root", attr: { dir: "auto" } });
		const date = meta.createSpan({ cls: "vault-lottery-card-date" });
		setIcon(date.createSpan(), "clock");
		date.createSpan({ text: new Date(file.stat.mtime).toLocaleDateString() });

		const tags = fileTags(this.app, file);
		if (tags.length) {
			const t = el.createDiv({ cls: "vault-lottery-chips" });
			for (const tag of Array.from(new Set(tags)).slice(0, 12)) t.createSpan({ cls: "vault-lottery-tag-chip", text: `#${tag}` });
		}
		const ex = el.createDiv({ cls: "vault-lottery-card-excerpt", attr: { dir: "auto" } });
		ex.setText("…");

		const actions = el.createDiv({ cls: "vault-lottery-card-actions" });
		const open = actions.createEl("button", { cls: "mod-cta", text: "Open" });
		open.addEventListener("click", (e) => this.actions.open(file, Keymap.isModEvent(e) !== false));
		const tab = actions.createEl("button", { text: "New tab" });
		tab.setAttr("aria-label", "Open in new tab");
		tab.addEventListener("click", () => this.actions.open(file, true));
		this.againBtn = actions.createEl("button", { text: "Draw again" });
		this.againBtn.addEventListener("click", () => this.actions.drawAgain());
		const more = actions.createEl("button", { cls: "vault-lottery-icon-btn clickable-icon", attr: { "aria-label": "More" } });
		setIcon(more, "more-horizontal");
		more.addEventListener("click", (e) => {
			const menu = new Menu();
			menu.addItem((i) =>
				i.setTitle("Copy link").setIcon("link").onClick(() => {
					const link = this.app.fileManager.generateMarkdownLink(file, "");
					void copyText(link, `Copied ${link}`);
				}),
			);
			if (hasFileExplorer(this.app)) {
				menu.addItem((i) => i.setTitle("Reveal in file explorer").setIcon("folder-open").onClick(() => revealInExplorer(this.app, file)));
			}
			menu.addItem((i) => i.setTitle("Exclude this note").setIcon("eye-off").onClick(() => this.actions.exclude(file)));
			menu.showAtMouseEvent(e);
		});
		this.updateDrawState();

		try {
			const text = await this.app.vault.cachedRead(file);
			ex.setText(excerpt(text) || "(empty note)");
			ex.toggleClass("is-empty", !excerpt(text));
		} catch {
			ex.setText("");
		}
	}
}
