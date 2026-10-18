// Team Picker: split into teams, pick one, or random order.

import { Notice, Setting, setIcon } from "obsidian";
import type { Game, GameContext } from "../Game";
import type { Person, Roster } from "../../settings";
import { TEAM_COLOR_NAMES } from "../../shared/color";
import { buildTickOverride, soundAppearanceSection } from "../../shared/appearance";
import { prefersReducedMotion } from "../../shared/Confetti";
import { copyText, createUniqueNote, timestamp } from "../../shared/insertResult";
import { pickFolder } from "../../shared/modals";
import { uid } from "../../shared/random";
import { SavedSetBar, uniqueName, type SavedSetAdapter } from "../../shared/SavedSetBar";
import { collapsible, numberInput, revealInScroller, segmented, setDisabled, setLocked } from "../../shared/ui";
import { RosterEditor } from "./RosterEditor";
import { TeamBoard, type Team } from "./TeamBoard";
import { pickOne, randomOrder, splitTeams, teamCountFor, teamSizes, type Constraint } from "./TeamSplitter";

type Result =
	| { kind: "teams"; teams: Team[]; warning?: string }
	| { kind: "pick"; person: Person }
	| { kind: "order"; list: Person[] };

export function cloneRoster(r: Roster): Roster {
	return JSON.parse(JSON.stringify(r)) as Roster;
}

export function teamNames(d: GameContext["plugin"]["data"]["teams"], k: number): { name: string; color: string }[] {
	return Array.from({ length: k }, (_, i) => {
		const [colorName, color] = TEAM_COLOR_NAMES[i % TEAM_COLOR_NAMES.length];
		let name = `Team ${i + 1}`;
		if (d.teamNaming === "colors") name = i < TEAM_COLOR_NAMES.length ? colorName : `${colorName} ${Math.floor(i / TEAM_COLOR_NAMES.length) + 1}`;
		if (d.teamNaming === "custom") name = d.customTeamNames[i]?.trim() || `Team ${i + 1}`;
		return { name, color };
	});
}

export function teamsMarkdown(teams: Team[]): string {
	return teams.map((t) => `### ${t.name}\n${t.members.map((m) => `- ${m.name}`).join("\n")}`).join("\n");
}

export function resultMarkdown(r: Result): string {
	if (r.kind === "teams") return teamsMarkdown(r.teams);
	if (r.kind === "pick") return `**Picked:** ${r.person.name}`;
	return r.list.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
}

export class TeamPickerGame implements Game {
	id = "teams";
	name = "Team Picker";
	icon = "users";

	private bar: SavedSetBar | null = null;
	private editor: RosterEditor | null = null;
	private board: TeamBoard | null = null;
	private goBtn: HTMLButtonElement | null = null;
	private optionsEl!: HTMLElement;
	private actionsEl!: HTMLElement;
	private resultWrap!: HTMLElement;
	private lockables: HTMLElement[] = [];
	private result: Result | null = null;
	private busy = false;
	private alive = false;

	constructor(private ctx: GameContext) {}

	private get d() {
		return this.ctx.plugin.data.teams;
	}

	private present(): Person[] {
		return this.d.workingRoster.people.filter((p) => p.present && p.name.trim());
	}

	mount(container: HTMLElement): void {
		this.alive = true;
		const barWrap = container.createDiv({ cls: "vault-lottery-block" });
		this.bar = new SavedSetBar(barWrap, this.ctx.app, this.rosterAdapter());

		const rosterBody = collapsible(container, "Roster", "teams-roster", true);
		this.editor = new RosterEditor(rosterBody, {
			app: this.ctx.app,
			roster: () => this.d.workingRoster,
			showSkill: () => this.d.mode === "teams" && this.d.balanceBySkill,
			changed: () => this.onRosterChanged(),
		});

		this.optionsEl = container.createDiv({ cls: "vault-lottery-team-options" });
		this.renderOptions();

		const go = container.createDiv({ cls: "vault-lottery-stage-actions" });
		this.goBtn = go.createEl("button", { cls: "mod-cta vault-lottery-play-btn" });
		this.goBtn.addEventListener("click", () => this.play());
		this.updateGo();

		this.resultWrap = container.createDiv({ cls: "vault-lottery-team-result" });
		this.board = new TeamBoard(this.resultWrap, {
			showSkill: () => this.d.balanceBySkill,
			onMove: (id, from, to) => this.movePerson(id, from, to),
			onColor: (i, c) => {
				if (this.result?.kind === "teams" && this.result.teams[i]) this.result.teams[i].color = c;
			},
			tick: () => this.ctx.audio.tick(this.d.tickSoundOverride),
			reducedMotion: () => prefersReducedMotion() && !this.ctx.plugin.data.confettiIgnoreReducedMotion,
		});
		this.actionsEl = container.createDiv({ cls: "vault-lottery-result-actions" });
		this.renderActions();

		const appearance = soundAppearanceSection(container, this.ctx.plugin, "teams", (el) => {
			buildTickOverride(el, this.ctx.plugin, () => this.d.tickSoundOverride, (v) => (this.d.tickSoundOverride = v));
			new Setting(el).setName("Confetti").addToggle((t) =>
				t.setValue(this.d.confetti).onChange((v) => {
					this.d.confetti = v;
					this.ctx.save();
				}),
			);
			const folder = new Setting(el).setName("Folder for saved team notes");
			const showFolder = () => folder.setDesc(this.d.saveFolder || "Vault root");
			showFolder();
			folder
				.addButton((b) => b.setButtonText("Choose…").onClick(async () => {
					const f = await pickFolder(this.ctx.app);
					if (!f) return;
					this.d.saveFolder = f.path;
					this.ctx.save();
					showFolder();
				}))
				.addExtraButton((b) => b.setIcon("x").setTooltip("Use vault root").onClick(() => {
					this.d.saveFolder = "";
					this.ctx.save();
					showFolder();
				}));
		});
		this.lockables = [barWrap, rosterBody.parentElement as HTMLElement, this.optionsEl, this.actionsEl, appearance.parentElement as HTMLElement];
	}

	unmount(): void {
		this.alive = false;
		this.board?.destroy();
		this.board = null;
		this.busy = false;
	}

	isBusy(): boolean {
		return this.busy;
	}

	private setBusy(b: boolean): void {
		this.busy = b;
		for (const el of this.lockables) setLocked(el, b);
		this.updateGo();
		this.ctx.busyChanged();
	}

	private onRosterChanged(): void {
		this.ctx.save();
		this.bar?.update();
		this.updateGo();
	}

	private goLabel(): string {
		return this.d.mode === "teams" ? "Make teams" : this.d.mode === "pick-one" ? "Pick one" : "Shuffle order";
	}

	private updateGo(): void {
		const b = this.goBtn;
		if (!b) return;
		b.empty();
		setIcon(b.createSpan(), this.d.mode === "teams" ? "users" : this.d.mode === "pick-one" ? "user-check" : "list-ordered");
		b.createSpan({ text: this.goLabel() });
		const n = this.present().length;
		const need = this.d.mode === "teams" ? 2 : 1;
		setDisabled(b, this.busy || n < need, n < need ? (need === 2 ? "Mark at least 2 people present" : "Mark at least 1 person present") : "");
	}

	private renderOptions(): void {
		const el = this.optionsEl;
		el.empty();
		segmented(
			el,
			[
				{ value: "teams", label: "Teams", icon: "users" },
				{ value: "pick-one", label: "Pick one", icon: "user-check" },
				{ value: "order", label: "Order", icon: "list-ordered" },
			],
			this.d.mode,
			(v) => {
				this.d.mode = v;
				this.ctx.save();
				this.renderOptions();
				this.editor?.render();
				this.updateGo();
			},
			"Mode",
		);
		const body = el.createDiv({ cls: "vault-lottery-options-body" });
		if (this.d.mode === "teams") {
			const row = body.createDiv({ cls: "vault-lottery-inline-fields" });
			const sel = row.createEl("select", { cls: "dropdown" });
			sel.createEl("option", { text: "Number of teams", value: "count" });
			sel.createEl("option", { text: "People per team", value: "size" });
			sel.value = this.d.splitBy;
			numberInput(row, this.d.splitBy === "count" ? this.d.teamCount : this.d.teamSize, 2, this.d.splitBy === "count" ? 20 : 50, (v) => {
				if (this.d.splitBy === "count") this.d.teamCount = v;
				else this.d.teamSize = v;
				this.ctx.save();
				updHint();
			});
			const hint = row.createSpan({ cls: "vault-lottery-muted" });
			const updHint = () => {
				const n = this.present().length;
				const k = teamCountFor(n, this.d.splitBy, this.d.splitBy === "count" ? this.d.teamCount : this.d.teamSize);
				const sizes = teamSizes(n, k);
				hint.setText(n ? `→ ${k} teams of ${Math.min(...sizes)}${Math.max(...sizes) !== Math.min(...sizes) ? `–${Math.max(...sizes)}` : ""}` : "");
			};
			updHint();
			sel.addEventListener("change", () => {
				this.d.splitBy = sel.value as "count" | "size";
				this.ctx.save();
				this.renderOptions();
			});
			new Setting(body).setName("Balance by skill").setDesc("Uses each person's 1–5 stars.").addToggle((t) =>
				t.setValue(this.d.balanceBySkill).onChange((v) => {
					this.d.balanceBySkill = v;
					this.ctx.save();
					this.editor?.render();
				}),
			);
			new Setting(body).setName("Team names").addDropdown((dd) =>
				dd.addOptions({ numbers: "Team 1…N", colors: "Colors", custom: "Custom" }).setValue(this.d.teamNaming).onChange((v) => {
					this.d.teamNaming = v as "numbers";
					this.ctx.save();
					this.renderOptions();
				}),
			);
			if (this.d.teamNaming === "custom") {
				const ta = body.createEl("textarea", { cls: "vault-lottery-faces", attr: { rows: "3", dir: "auto", "aria-label": "Custom team names, one per line" } });
				ta.placeholder = "One team name per line";
				ta.value = this.d.customTeamNames.join("\n");
				ta.addEventListener("change", () => {
					this.d.customTeamNames = ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
					this.ctx.save();
				});
			}
		} else if (this.d.mode === "pick-one") {
			new Setting(body).setName("Don't pick the same person twice in a row").addToggle((t) =>
				t.setValue(this.d.noRepeatPick).onChange((v) => {
					this.d.noRepeatPick = v;
					this.ctx.save();
				}),
			);
		}
		new Setting(body).setName("Instant mode").setDesc("Skip the animation.").addToggle((t) =>
			t.setValue(this.d.instant).onChange((v) => {
				this.d.instant = v;
				this.ctx.save();
			}),
		);
	}

	private renderActions(): void {
		const el = this.actionsEl;
		el.empty();
		if (!this.result) return;
		const mk = (icon: string, text: string, fn: () => void) => {
			const b = el.createEl("button");
			setIcon(b.createSpan(), icon);
			b.createSpan({ text });
			b.addEventListener("click", fn);
			return b;
		};
		mk("shuffle", "Reshuffle", () => this.play());
		mk("copy", "Copy as Markdown", () => this.result && void copyText(resultMarkdown(this.result)));
		mk("text-cursor-input", "Insert into note", () => this.result && void this.ctx.plugin.editors.insertOrCopy(resultMarkdown(this.result), true));
		mk("file-plus", "Save as new note", () => void this.saveAsNote());
	}

	private async saveAsNote(): Promise<void> {
		if (!this.result) return;
		const { date, time } = timestamp();
		try {
			const f = await createUniqueNote(this.ctx.app, this.d.saveFolder, `Teams ${date} ${time}`, resultMarkdown(this.result) + "\n");
			await this.ctx.plugin.notes.open(f, true);
		} catch (e) {
			console.error("Vault Lottery: save note failed", e);
			new Notice("Could not create the note.");
		}
	}

	private movePerson(id: string, from: number, to: number): void {
		if (this.result?.kind !== "teams") return;
		const teams = this.result.teams;
		const i = teams[from]?.members.findIndex((m) => m.id === id) ?? -1;
		if (i < 0 || !teams[to]) return;
		const [p] = teams[from].members.splice(i, 1);
		teams[to].members.push(p);
		this.board?.showTeams(teams, this.result.warning);
		this.ctx.announce(`${p.name} moved to ${teams[to].name}`);
	}

	play(): void {
		if (this.busy || !this.board) return;
		const people = this.present();
		if (this.d.mode === "teams") void this.makeTeams(people);
		else if (this.d.mode === "pick-one") void this.pickOne(people);
		else void this.makeOrder(people);
	}

	/** Builds a team result without UI (also used for the board). */
	computeTeams(people: Person[]): { teams: Team[]; warning?: string } {
		const d = this.d;
		const k = teamCountFor(people.length, d.splitBy, d.splitBy === "count" ? d.teamCount : d.teamSize);
		const constraints: Constraint[] = [
			...d.workingRoster.keepApart.map(([a, b]) => ({ a, b, kind: "apart" as const })),
			...d.workingRoster.keepTogether.map(([a, b]) => ({ a, b, kind: "together" as const })),
		];
		const split = splitTeams(people, k, { balance: d.balanceBySkill, constraints });
		const names = teamNames(d, k);
		const teams = split.teams.map((members, i) => ({ name: names[i].name, color: names[i].color, members }));
		let warning: string | undefined;
		if (split.violations.length) {
			const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
			warning = `Couldn't satisfy all constraints: ${split.violations
				.map((v) => `${nameOf(v.a)} ${v.kind === "apart" ? "≠" : "+"} ${nameOf(v.b)}`)
				.join(", ")}`;
		}
		return { teams, warning };
	}

	private start(): void {
		this.setBusy(true);
		this.actionsEl.empty();
		window.setTimeout(() => revealInScroller(this.resultWrap), 30);
		if (!this.d.instant) this.ctx.audio.gameStart();
	}

	private end(confettiFrom: HTMLElement | null, colors?: string[]): void {
		if (!this.alive) return;
		if (!this.d.instant) this.ctx.audio.gameEnd();
		this.setBusy(false);
		this.renderActions();
		if (this.d.confetti && confettiFrom) this.ctx.celebrate(confettiFrom, colors, confettiFrom);
	}

	private async makeTeams(people: Person[]): Promise<void> {
		if (people.length < 2) return;
		const { teams, warning } = this.computeTeams(people);
		this.result = { kind: "teams", teams, warning };
		this.start();
		if (this.d.instant) this.board?.showTeams(teams, warning);
		else await this.board?.dealTeams(teams, warning);
		if (!this.alive) return;
		this.ctx.announce(teams.map((t) => `${t.name}: ${t.members.map((m) => m.name).join(", ")}`).join(". "));
		this.end(this.board?.el ?? null, teams.map((t) => t.color));
	}

	private async pickOne(people: Person[]): Promise<void> {
		const p = pickOne(people, this.d.lastPickedId, this.d.noRepeatPick);
		if (!p) return;
		this.d.lastPickedId = p.id;
		this.ctx.save();
		this.result = { kind: "pick", person: p };
		this.start();
		const box = await this.board?.pickOne(people, p, 3000, this.d.instant);
		if (!this.alive) return;
		this.ctx.announce(`Picked ${p.name}`);
		this.end(box ?? null);
	}

	private async makeOrder(people: Person[]): Promise<void> {
		if (!people.length) return;
		const list = randomOrder(people);
		this.result = { kind: "order", list };
		this.start();
		await this.board?.order(list, this.d.instant);
		if (!this.alive) return;
		this.ctx.announce(`Order: ${list.map((p) => p.name).join(", ")}`);
		this.end(null);
	}

	/** "Team Picker: Load roster…" */
	loadRoster(id: string): void {
		if (this.busy) return;
		this.rosterAdapter().load(id);
		this.bar?.update();
	}

	private rosterAdapter(): SavedSetAdapter {
		const d = this.d;
		const loaded = () => d.rosters.find((r) => r.id === d.loadedRosterId);
		return {
			noun: "roster",
			items: () => d.rosters,
			loadedId: () => d.loadedRosterId,
			isDirty: () => {
				const l = loaded();
				if (!l) return false;
				const strip = (r: Roster) => JSON.stringify({ ...r, id: "", name: "" });
				return strip(l) !== strip(d.workingRoster);
			},
			load: (id) => {
				const r = d.rosters.find((x) => x.id === id);
				if (!r) return;
				d.workingRoster = { ...cloneRoster(r), id: "working" };
				d.loadedRosterId = id;
				this.ctx.save();
				this.editor?.render();
				this.updateGo();
				this.renderOptions();
			},
			save: () => {
				const l = loaded();
				if (!l) return;
				const c = cloneRoster(d.workingRoster);
				l.people = c.people;
				l.keepApart = c.keepApart;
				l.keepTogether = c.keepTogether;
				this.ctx.save();
				this.bar?.update();
			},
			saveAs: (name) => {
				const r = { ...cloneRoster(d.workingRoster), id: uid(), name: uniqueName(name, d.rosters.map((x) => x.name)) };
				d.rosters.push(r);
				d.loadedRosterId = r.id;
				this.ctx.save();
			},
			rename: (id, name) => {
				const r = d.rosters.find((x) => x.id === id);
				if (!r) return;
				r.name = uniqueName(name, d.rosters.filter((x) => x.id !== id).map((x) => x.name));
				this.ctx.save();
			},
			remove: (id) => {
				d.rosters = d.rosters.filter((x) => x.id !== id);
				if (d.loadedRosterId === id) d.loadedRosterId = null;
				this.ctx.save();
			},
		};
	}
}
