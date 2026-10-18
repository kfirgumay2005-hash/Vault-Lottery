// Roster editor: people (present, name, optional skill), paste list, import from note, constraints.

import { App, Notice, setIcon, setTooltip } from "obsidian";
import type { Person, Roster } from "../../settings";
import { pickFile, prompt } from "../../shared/modals";
import { uid } from "../../shared/random";
import { collapsible, iconButton } from "../../shared/ui";

export interface RosterHost {
	app: App;
	roster(): Roster;
	showSkill(): boolean;
	changed(structural: boolean): void;
}

/** "Name | 3" → { name, skill }. */
export function parseLine(line: string): { name: string; skill?: number } | null {
	const t = line.trim();
	if (!t) return null;
	const m = t.match(/^(.*?)\s*\|\s*(\d+)\s*$/);
	if (m && m[1].trim()) {
		const s = Math.max(1, Math.min(5, parseInt(m[2], 10)));
		return { name: m[1].trim(), skill: s };
	}
	return { name: t };
}

/** Top-level list items ("- Name", "* Name", "- [ ] Name"), skipping nested ones. */
export function listItemsFromNote(text: string): string[] {
	const out: string[] = [];
	let inFrontmatter = text.startsWith("---");
	let first = true;
	for (const raw of text.split(/\r?\n/)) {
		if (inFrontmatter) {
			if (!first && /^(---|\.\.\.)\s*$/.test(raw)) inFrontmatter = false;
			first = false;
			continue;
		}
		const m = raw.match(/^[-*+]\s+(?:\[.\]\s+)?(.+)$/);
		if (m) {
			const name = m[1].replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[*_=~`]/g, "").trim();
			if (name) out.push(name);
		}
	}
	return out;
}

export function duplicateNames(people: Person[]): Set<string> {
	const seen = new Map<string, number>();
	for (const p of people) {
		const k = p.name.trim().toLowerCase();
		if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
	}
	return new Set(Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k));
}

export class RosterEditor {
	readonly el: HTMLElement;
	private counter!: HTMLElement;
	private list!: HTMLElement;
	private constraintsBody!: HTMLElement;

	constructor(parent: HTMLElement, private host: RosterHost) {
		this.el = parent.createDiv({ cls: "vault-lottery-roster-editor" });
		this.render();
	}

	private get r(): Roster {
		return this.host.roster();
	}

	render(): void {
		this.el.empty();
		const top = this.el.createDiv({ cls: "vault-lottery-row vault-lottery-wrap" });
		this.counter = top.createSpan({ cls: "vault-lottery-muted vault-lottery-counter-inline" });
		const quick = top.createDiv({ cls: "vault-lottery-row-buttons" });
		const all = quick.createEl("button", { text: "All present", cls: "vault-lottery-small-btn" });
		all.addEventListener("click", () => this.setAll(true));
		const none = quick.createEl("button", { text: "None present", cls: "vault-lottery-small-btn" });
		none.addEventListener("click", () => this.setAll(false));

		this.list = this.el.createDiv({ cls: "vault-lottery-people" });
		this.renderPeople();

		const actions = this.el.createDiv({ cls: "vault-lottery-row vault-lottery-wrap" });
		const add = actions.createEl("button", { cls: "mod-cta vault-lottery-add" });
		setIcon(add.createSpan(), "user-plus");
		add.createSpan({ text: "Add person" });
		add.addEventListener("click", () => this.addPerson());
		const paste = actions.createEl("button", { text: "Paste list" });
		paste.addEventListener("click", () => void this.pasteList());
		const imp = actions.createEl("button", { text: "Import from note" });
		imp.addEventListener("click", () => void this.importNote());

		this.constraintsBody = collapsible(this.el, "Constraints", "teams-constraints", false);
		this.renderConstraints();
	}

	private renderPeople(): void {
		this.list.empty();
		const dups = duplicateNames(this.r.people);
		if (!this.r.people.length) {
			this.list.createDiv({ cls: "vault-lottery-muted", text: "No people yet. Add them one by one, paste a list, or import a note." });
		}
		this.r.people.forEach((p, i) => {
			const row = this.list.createDiv({ cls: "vault-lottery-person" });
			row.toggleClass("is-absent", !p.present);
			const cb = row.createEl("input", { type: "checkbox", attr: { "aria-label": `${p.name || "Person"} present` } });
			cb.checked = p.present;
			cb.addEventListener("change", () => {
				p.present = cb.checked;
				row.toggleClass("is-absent", !p.present);
				this.updateCounter();
				this.host.changed(false);
			});
			const name = row.createEl("input", { type: "text", cls: "vault-lottery-grow", attr: { "aria-label": "Name", dir: "auto" } });
			name.value = p.name;
			name.placeholder = `Person ${i + 1}`;
			if (dups.has(p.name.trim().toLowerCase())) {
				name.addClass("is-duplicate");
				setTooltip(name, "Duplicate name");
			}
			name.addEventListener("input", () => {
				p.name = name.value;
				this.host.changed(false);
			});
			name.addEventListener("change", () => {
				this.renderPeople();
				this.renderConstraints();
			});
			name.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					if (i === this.r.people.length - 1) this.addPerson();
					else (this.list.querySelectorAll<HTMLInputElement>("input[type=text]")[i + 1])?.focus();
				}
			});
			if (this.host.showSkill()) this.stars(row, p);
			iconButton(row, "x", "Remove person", () => {
				this.r.people.splice(i, 1);
				const id = p.id;
				this.r.keepApart = this.r.keepApart.filter(([a, b]) => a !== id && b !== id);
				this.r.keepTogether = this.r.keepTogether.filter(([a, b]) => a !== id && b !== id);
				this.host.changed(true);
				this.renderPeople();
				this.renderConstraints();
			});
		});
		this.updateCounter();
	}

	private stars(row: HTMLElement, p: Person): void {
		const wrap = row.createDiv({ cls: "vault-lottery-stars", attr: { role: "radiogroup", "aria-label": "Skill" } });
		const set = (v: number) => {
			wrap.querySelectorAll("button").forEach((b, k) => {
				b.toggleClass("is-on", k < v);
				b.setAttr("aria-checked", String(k + 1 === v));
			});
		};
		for (let k = 1; k <= 5; k++) {
			const b = wrap.createEl("button", { cls: "vault-lottery-star", attr: { role: "radio", "aria-label": `Skill ${k}` } });
			setIcon(b, "star");
			b.addEventListener("click", () => {
				p.skill = p.skill === k ? undefined : k;
				set(p.skill ?? 0);
				this.host.changed(false);
			});
		}
		set(p.skill ?? 0);
	}

	private updateCounter(): void {
		const present = this.r.people.filter((p) => p.present).length;
		this.counter.setText(`${present} of ${this.r.people.length} present`);
	}

	private setAll(v: boolean): void {
		for (const p of this.r.people) p.present = v;
		this.host.changed(false);
		this.renderPeople();
	}

	private addPerson(name = ""): void {
		this.r.people.push({ id: uid(), name, present: true });
		this.host.changed(true);
		this.renderPeople();
		this.renderConstraints();
		const inputs = this.list.querySelectorAll<HTMLInputElement>("input[type=text]");
		inputs[inputs.length - 1]?.focus();
	}

	private async pasteList(): Promise<void> {
		const text = await prompt(this.host.app, "Paste list", "", {
			multiline: true,
			cta: "Add",
			placeholder: "One name per line\nDana | 4\nOmer",
			description: "One name per line. Add \"| 1–5\" after a name to set skill.",
		});
		if (!text) return;
		this.addNames(text.split(/\r?\n/).map(parseLine).filter((x): x is { name: string; skill?: number } => !!x));
	}

	private async importNote(): Promise<void> {
		const f = await pickFile(this.host.app, ["md"], "Import people from a note (top-level list items)…");
		if (!f) return;
		const text = await this.host.app.vault.cachedRead(f);
		const names = listItemsFromNote(text).map(parseLine).filter((x): x is { name: string; skill?: number } => !!x);
		if (!names.length) {
			new Notice("No top-level list items found in that note.");
			return;
		}
		this.addNames(names);
	}

	private addNames(items: { name: string; skill?: number }[]): void {
		for (const it of items) this.r.people.push({ id: uid(), name: it.name, present: true, skill: it.skill });
		const dups = duplicateNames(this.r.people);
		new Notice(`Added ${items.length} ${items.length === 1 ? "person" : "people"}${dups.size ? ` — ${dups.size} duplicate name${dups.size === 1 ? "" : "s"} flagged` : ""}`);
		this.host.changed(true);
		this.renderPeople();
		this.renderConstraints();
	}

	private renderConstraints(): void {
		const body = this.constraintsBody;
		if (!body) return;
		body.empty();
		body.createDiv({ cls: "vault-lottery-muted vault-lottery-small", text: "Applied when making teams. If they can't all be met, you'll see a warning." });
		this.pairEditor(body, "Keep apart", this.r.keepApart);
		this.pairEditor(body, "Keep together", this.r.keepTogether);
	}

	private pairEditor(body: HTMLElement, title: string, pairs: [string, string][]): void {
		body.createDiv({ cls: "vault-lottery-subhead", text: title });
		const people = this.r.people.filter((p) => p.name.trim());
		const nameOf = (id: string) => this.r.people.find((p) => p.id === id)?.name || "?";
		const list = body.createDiv({ cls: "vault-lottery-chips" });
		pairs.forEach(([a, b], i) => {
			const c = list.createDiv({ cls: "vault-lottery-chip" });
			c.createSpan({ text: `${nameOf(a)} ↔ ${nameOf(b)}`, attr: { dir: "auto" } });
			const x = c.createEl("button", { cls: "vault-lottery-chip-x", attr: { "aria-label": "Remove pair" } });
			setIcon(x, "x");
			x.addEventListener("click", () => {
				pairs.splice(i, 1);
				this.host.changed(false);
				this.renderConstraints();
			});
		});
		if (people.length < 2) return;
		const row = body.createDiv({ cls: "vault-lottery-inline-fields" });
		const mk = () => {
			const s = row.createEl("select", { cls: "dropdown vault-lottery-grow" });
			for (const p of people) s.createEl("option", { text: p.name, value: p.id });
			return s;
		};
		const s1 = mk();
		const s2 = mk();
		if (people[1]) s2.value = people[1].id;
		const add = row.createEl("button", { text: "Add", cls: "vault-lottery-small-btn" });
		add.addEventListener("click", () => {
			const a = s1.value;
			const b = s2.value;
			if (!a || !b || a === b) {
				new Notice("Choose two different people.");
				return;
			}
			if (pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return;
			pairs.push([a, b]);
			this.host.changed(false);
			this.renderConstraints();
		});
	}
}
