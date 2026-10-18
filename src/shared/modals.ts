// Small reusable modals: text prompt, confirmation, file / item pickers.

import { App, FuzzySuggestModal, Modal, Setting, TFile, TFolder } from "obsidian";

export class PromptModal extends Modal {
	private value: string;
	private done = false;

	constructor(
		app: App,
		private titleText: string,
		initial: string,
		private onSubmit: (value: string) => void,
		private opts: { placeholder?: string; cta?: string; multiline?: boolean; description?: string } = {},
	) {
		super(app);
		this.value = initial;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText(this.titleText);
		contentEl.addClass("vault-lottery-modal");
		if (this.opts.description) contentEl.createEl("p", { text: this.opts.description, cls: "setting-item-description" });
		let input: HTMLInputElement | HTMLTextAreaElement;
		if (this.opts.multiline) {
			input = contentEl.createEl("textarea", { cls: "vault-lottery-textarea" });
			input.rows = 10;
		} else {
			input = contentEl.createEl("input", { type: "text", cls: "vault-lottery-prompt-input" });
		}
		input.value = this.value;
		input.setAttr("dir", "auto");
		if (this.opts.placeholder) input.placeholder = this.opts.placeholder;
		input.addEventListener("input", () => (this.value = input.value));
		if (!this.opts.multiline) {
			input.addEventListener("keydown", (e: Event) => {
				if (!(e instanceof KeyboardEvent)) return;
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					this.submit();
				}
			});
		}
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText(this.opts.cta ?? "OK").setCta().onClick(() => this.submit()));
		window.setTimeout(() => {
			input.focus();
			if (input instanceof HTMLInputElement) input.select();
		}, 30);
	}

	private submit(): void {
		if (this.done) return;
		const v = this.opts.multiline ? this.value : this.value.trim();
		if (!this.opts.multiline && !v) return;
		this.done = true;
		this.close();
		this.onSubmit(v);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function prompt(
	app: App,
	title: string,
	initial = "",
	opts: { placeholder?: string; cta?: string; multiline?: boolean; description?: string } = {},
): Promise<string | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const m = new PromptModal(app, title, initial, (v) => {
			resolved = true;
			resolve(v);
		}, opts);
		const origClose = m.onClose.bind(m);
		m.onClose = () => {
			origClose();
			window.setTimeout(() => {
				if (!resolved) resolve(null);
			}, 0);
		};
		m.open();
	});
}

export class ConfirmModal extends Modal {
	private result = false;

	constructor(
		app: App,
		private titleText: string,
		private message: string,
		private cta: string,
		private onDone: (ok: boolean) => void,
		private danger = false,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.titleText);
		this.contentEl.addClass("vault-lottery-modal");
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				b.setButtonText(this.cta).onClick(() => {
					this.result = true;
					this.close();
				});
				if (this.danger) b.setWarning();
				else b.setCta();
			});
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDone(this.result);
	}
}

export function confirm(app: App, title: string, message: string, cta = "OK", danger = false): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, title, message, cta, resolve, danger).open());
}

/** Generic fuzzy picker over arbitrary items. */
export class ItemSuggestModal<T> extends FuzzySuggestModal<T> {
	private chosen = false;

	constructor(
		app: App,
		private items: T[],
		private text: (item: T) => string,
		private onChoose: (item: T) => void,
		placeholder?: string,
		private onCancel?: () => void,
	) {
		super(app);
		if (placeholder) this.setPlaceholder(placeholder);
	}

	getItems(): T[] {
		return this.items;
	}

	getItemText(item: T): string {
		return this.text(item);
	}

	onChooseItem(item: T): void {
		this.chosen = true;
		this.onChoose(item);
	}

	onClose(): void {
		super.onClose();
		// onChooseItem runs after onClose in some versions; defer the cancel check.
		window.setTimeout(() => {
			if (!this.chosen) this.onCancel?.();
		}, 50);
	}
}

export function pickItem<T>(app: App, items: T[], text: (item: T) => string, placeholder?: string): Promise<T | null> {
	return new Promise((resolve) => {
		new ItemSuggestModal(app, items, text, (i) => resolve(i), placeholder, () => resolve(null)).open();
	});
}

export function filesWithExtensions(app: App, exts: string[]): TFile[] {
	const set = new Set(exts.map((e) => e.toLowerCase()));
	return app.vault.getFiles().filter((f) => set.has(f.extension.toLowerCase()));
}

export function pickFile(app: App, exts: string[], placeholder: string): Promise<TFile | null> {
	const files = filesWithExtensions(app, exts).sort((a, b) => a.path.localeCompare(b.path));
	return pickItem(app, files, (f) => f.path, placeholder);
}

export function allFolders(app: App): TFolder[] {
	return app.vault
		.getAllLoadedFiles()
		.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
		.sort((a, b) => a.path.localeCompare(b.path));
}

export function pickFolder(app: App, placeholder = "Choose a folder…"): Promise<TFolder | null> {
	return pickItem(app, allFolders(app), (f) => f.path, placeholder);
}

/** Opens the system file chooser (computer / phone). Resolves null when nothing was chosen. */
export function pickDeviceFile(accept: string): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.body.createEl("input", { type: "file", cls: "vault-lottery-hidden" });
		input.accept = accept;
		let done = false;
		const finish = (f: File | null) => {
			if (done) return;
			done = true;
			input.remove();
			resolve(f);
		};
		input.addEventListener("change", () => finish(input.files?.[0] ?? null));
		input.addEventListener("cancel", () => finish(null));
		input.click();
	});
}
