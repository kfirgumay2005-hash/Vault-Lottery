// Filter editor: one row per rule, each with its own on/off checkbox.

import { App, TFile } from "obsidian";
import type { FilterRule, NoteFilter } from "../../settings";
import { allFolders, pickItem } from "../../shared/modals";
import { chip, iconButton } from "../../shared/ui";
import { fileTags, ruleOn } from "./NoteFilter";

export interface FilterEditorHost {
	app: App;
	filter(): NoteFilter;
	excludedNotes(): string[];
	changed(): void;
	preview(): void;
}

function allTags(app: App): string[] {
	const set = new Set<string>();
	for (const f of app.vault.getMarkdownFiles()) for (const t of fileTags(app, f)) set.add(t);
	return Array.from(set).sort();
}

export class FilterEditor {
	readonly el: HTMLElement;

	constructor(parent: HTMLElement, private host: FilterEditorHost) {
		this.el = parent.createDiv({ cls: "vault-lottery-filter-editor" });
		this.render();
	}

	private get f(): NoteFilter {
		return this.host.filter();
	}

	private changed(rerender = false): void {
		this.host.changed();
		if (rerender) this.render();
	}

	render(): void {
		this.el.empty();
		this.listRule("includeFolders", "Include folders", "Whole vault", this.f.includeFolders, () => this.addFolder(this.f.includeFolders), "folder");
		this.listRule("excludeFolders", "Exclude folders", "None", this.f.excludeFolders, () => this.addFolder(this.f.excludeFolders), "folder");
		this.listRule("includeTags", "Include tags", "Any note", this.f.includeTags, () => this.addTag(this.f.includeTags), "tag", (row) => {
			const sel = row.createEl("select", { cls: "dropdown vault-lottery-small-select", attr: { "aria-label": "Tag match mode" } });
			sel.createEl("option", { text: "Any of", value: "any" });
			sel.createEl("option", { text: "All of", value: "all" });
			sel.value = this.f.includeTagsMode;
			sel.addEventListener("change", () => {
				this.f.includeTagsMode = sel.value as "any" | "all";
				this.changed();
			});
		});
		this.listRule("excludeTags", "Exclude tags", "None", this.f.excludeTags, () => this.addTag(this.f.excludeTags), "tag");
		this.propertyRule();
		this.dateRule("modified", "Modified");
		this.dateRule("created", "Created");
		this.textRule();
		this.minWordsRule();

		const active = this.el.createEl("label", { cls: "vault-lottery-check-row" });
		const cb = active.createEl("input", { type: "checkbox" });
		cb.checked = this.f.excludeActiveNote;
		cb.addEventListener("change", () => {
			this.f.excludeActiveNote = cb.checked;
			this.changed();
		});
		active.createSpan({ text: "Exclude the active note" });

		const excluded = this.host.excludedNotes();
		if (excluded.length) {
			const box = this.el.createDiv({ cls: "vault-lottery-rule" });
			const head = box.createDiv({ cls: "vault-lottery-rule-head" });
			head.createSpan({ text: `Excluded notes (${excluded.length})`, cls: "vault-lottery-rule-name" });
			const chips = box.createDiv({ cls: "vault-lottery-chips" });
			for (const p of excluded.slice()) {
				chip(chips, p.replace(/\.md$/, "").split("/").pop() ?? p, () => {
					excluded.splice(excluded.indexOf(p), 1);
					this.changed(true);
				}).setAttr("title", p);
			}
		}

		const actions = this.el.createDiv({ cls: "vault-lottery-row" });
		const prev = actions.createEl("button", { text: "Preview range" });
		prev.addEventListener("click", () => this.host.preview());
		const reset = actions.createEl("button", { text: "Clear filters", cls: "mod-muted" });
		reset.addEventListener("click", () => {
			const f = this.f;
			f.includeFolders.length = 0;
			f.excludeFolders.length = 0;
			f.includeTags.length = 0;
			f.excludeTags.length = 0;
			f.property = undefined;
			f.modified = undefined;
			f.created = undefined;
			f.nameContains = undefined;
			f.minWords = undefined;
			f.disabledRules = [];
			this.changed(true);
		});
	}

	/** Rule box with an enable checkbox. */
	private ruleBox(rule: FilterRule, name: string): { box: HTMLElement; head: HTMLElement; body: HTMLElement } {
		const box = this.el.createDiv({ cls: "vault-lottery-rule" });
		const on = ruleOn(this.f, rule);
		box.toggleClass("is-off", !on);
		const head = box.createDiv({ cls: "vault-lottery-rule-head" });
		const label = head.createEl("label", { cls: "vault-lottery-rule-toggle" });
		const cb = label.createEl("input", { type: "checkbox", attr: { "aria-label": `Use rule: ${name}` } });
		cb.checked = on;
		cb.addEventListener("change", () => {
			const list = this.f.disabledRules;
			const i = list.indexOf(rule);
			if (cb.checked && i >= 0) list.splice(i, 1);
			if (!cb.checked && i < 0) list.push(rule);
			box.toggleClass("is-off", !cb.checked);
			this.changed();
		});
		label.createSpan({ text: name, cls: "vault-lottery-rule-name" });
		const body = box.createDiv({ cls: "vault-lottery-rule-body" });
		return { box, head, body };
	}

	private listRule(
		rule: FilterRule,
		name: string,
		emptyText: string,
		list: string[],
		add: () => void,
		kind: "folder" | "tag",
		extraHead?: (head: HTMLElement) => void,
	): void {
		const { head, body } = this.ruleBox(rule, name);
		extraHead?.(head);
		iconButton(head, "plus", kind === "folder" ? "Add folder" : "Add tag", add);
		const chips = body.createDiv({ cls: "vault-lottery-chips" });
		if (!list.length) chips.createSpan({ text: emptyText, cls: "vault-lottery-muted" });
		for (const item of list.slice()) {
			chip(chips, kind === "tag" ? `#${item}` : item, () => {
				list.splice(list.indexOf(item), 1);
				this.changed(true);
			});
		}
	}

	private async addFolder(list: string[]): Promise<void> {
		const folders = allFolders(this.host.app).filter((f) => !list.includes(f.path));
		const f = await pickItem(this.host.app, folders, (x) => x.path, "Choose a folder (subfolders included)…");
		if (!f) return;
		list.push(f.path);
		this.changed(true);
	}

	private async addTag(list: string[]): Promise<void> {
		const tags = allTags(this.host.app).filter((t) => !list.includes(t));
		const t = await pickItem(this.host.app, tags, (x) => `#${x}`, "Choose a tag (nested tags included)…");
		if (!t) return;
		list.push(t);
		this.changed(true);
	}

	private propertyRule(): void {
		const { body } = this.ruleBox("property", "Property");
		const p = this.f.property ?? { key: "", op: "exists" as const, value: "" };
		const row = body.createDiv({ cls: "vault-lottery-inline-fields" });
		const key = row.createEl("input", { type: "text", placeholder: "Property name", cls: "vault-lottery-grow" });
		key.value = p.key;
		const listId = `vl-props-${Math.floor(performance.now())}`;
		const dl = row.createEl("datalist", { attr: { id: listId } });
		key.setAttr("list", listId);
		key.addEventListener("focus", () => {
			if (dl.childElementCount) return;
			const keys = new Set<string>();
			for (const f of this.host.app.vault.getMarkdownFiles()) {
				const fm = this.host.app.metadataCache.getFileCache(f)?.frontmatter;
				if (fm) for (const k of Object.keys(fm)) if (k !== "position") keys.add(k);
			}
			for (const k of Array.from(keys).sort()) dl.createEl("option", { value: k });
		});
		const op = row.createEl("select", { cls: "dropdown" });
		for (const [v, t] of [["exists", "exists"], ["not-exists", "doesn't exist"], ["equals", "equals"], ["contains", "contains"]]) {
			op.createEl("option", { text: t, value: v });
		}
		op.value = p.op;
		const value = row.createEl("input", { type: "text", placeholder: "Value", cls: "vault-lottery-grow" });
		value.value = p.value ?? "";
		value.setAttr("dir", "auto");
		const showValue = () => value.toggle(op.value === "equals" || op.value === "contains");
		showValue();
		const commit = () => {
			if (!key.value.trim()) {
				this.f.property = undefined;
			} else {
				this.f.property = { key: key.value.trim(), op: op.value as "exists", value: value.value };
			}
			showValue();
			this.changed();
		};
		key.addEventListener("input", commit);
		op.addEventListener("change", commit);
		value.addEventListener("input", commit);
	}

	private dateRule(rule: "modified" | "created", name: string): void {
		const { body } = this.ruleBox(rule, name);
		const cur = this.f[rule];
		const row = body.createDiv({ cls: "vault-lottery-inline-fields" });
		const op = row.createEl("select", { cls: "dropdown" });
		op.createEl("option", { text: "within the last", value: "within" });
		op.createEl("option", { text: "more than", value: "older-than" });
		op.value = cur?.op ?? "within";
		const days = row.createEl("input", { type: "number", cls: "vault-lottery-number", placeholder: "—" });
		days.min = "0";
		days.inputMode = "numeric";
		days.value = cur?.days ? String(cur.days) : "";
		row.createSpan({ text: op.value === "within" ? "days" : "days ago", cls: "vault-lottery-muted" });
		const unit = row.lastElementChild as HTMLElement;
		const commit = () => {
			const n = parseInt(days.value);
			this.f[rule] = Number.isFinite(n) && n > 0 ? { op: op.value as "within", days: n } : undefined;
			unit.setText(op.value === "within" ? "days" : "days ago");
			this.changed();
		};
		op.addEventListener("change", commit);
		days.addEventListener("input", commit);
	}

	private textRule(): void {
		const { body } = this.ruleBox("nameContains", "Name contains");
		const input = body.createEl("input", { type: "text", placeholder: "Text in the note name", cls: "vault-lottery-full" });
		input.value = this.f.nameContains ?? "";
		input.setAttr("dir", "auto");
		input.addEventListener("input", () => {
			this.f.nameContains = input.value || undefined;
			this.changed();
		});
	}

	private minWordsRule(): void {
		const { body } = this.ruleBox("minWords", "Minimum words");
		const row = body.createDiv({ cls: "vault-lottery-inline-fields" });
		const input = row.createEl("input", { type: "number", cls: "vault-lottery-number", placeholder: "—" });
		input.min = "0";
		input.inputMode = "numeric";
		input.value = this.f.minWords ? String(this.f.minWords) : "";
		row.createSpan({ text: "words (skips stubs; reads notes)", cls: "vault-lottery-muted" });
		input.addEventListener("input", () => {
			const n = parseInt(input.value);
			this.f.minWords = Number.isFinite(n) && n > 0 ? n : undefined;
			this.changed();
		});
	}
}

export function describeFile(file: TFile): string {
	return file.path.replace(/\.md$/, "");
}
