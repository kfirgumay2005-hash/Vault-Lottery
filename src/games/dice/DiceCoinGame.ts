// Dice & Coin: fast decision tools. One click (or key) to a result, short animations, instant mode.

import { Setting, setIcon, setTooltip } from "obsidian";
import type { Game, GameContext } from "../Game";
import { cropImage } from "../../images/CropModal";
import type { CustomDie } from "../../settings";
import { themeColor } from "../../shared/color";
import { buildAudioSlot, buildBackground } from "../../shared/appearance";
import { uid } from "../../shared/random";
import { collapsible, onLongPress, consumeLongPressClick, relativeTime, segmented, setDisabled, setLocked } from "../../shared/ui";
import { CoinCanvas } from "./CoinCanvas";
import {
	STANDARD_DICE, addDie, describe, formatNotation, isSingleD20, parseNotation, removeDie, reroll, roll,
	type ParsedNotation, type RollResult,
} from "./DiceNotation";
import { DiceTray, type TrayDie } from "./DiceTray";
import { addHistory, coinText, flipSeries, seriesWinner, type Side } from "./diceLogic";
import { NotationPromptModal } from "./NotationPrompt";

const LABEL_PRESETS: [string, string][] = [
	["Heads", "Tails"],
	["Yes", "No"],
	["Do it", "Skip it"],
];

/** Session stats survive game switches (not saved). */
const session = {
	coin: { counts: [0, 0] as [number, number], streakSide: null as Side | null, streak: 0 },
	dice: { rolls: 0, totalSum: 0, totals: 0 },
};

export class DiceCoinGame implements Game {
	id = "dice";
	name = "Dice & Coin";
	icon = "dice-5";

	private root: HTMLElement | null = null;
	private stageWrap!: HTMLElement;
	private actionsEl!: HTMLElement;
	private resultEl!: HTMLElement;
	private toolsEl!: HTMLElement;
	private optionsHost!: HTMLElement;
	private historyEl!: HTMLElement;
	private coin: CoinCanvas | null = null;
	private tray: DiceTray | null = null;
	private playBtn: HTMLButtonElement | null = null;
	private rerollBtn: HTMLButtonElement | null = null;
	private notationInput: HTMLInputElement | null = null;
	private notationError: HTMLElement | null = null;
	private lockables: HTMLElement[] = [];
	private parsed: ParsedNotation | null = null;
	private last: RollResult | null = null;
	private busy = false;
	private alive = false;

	constructor(private ctx: GameContext) {}

	private get d() {
		return this.ctx.plugin.data.dice;
	}

	mount(container: HTMLElement): void {
		this.alive = true;
		this.root = container;
		segmented(
			container.createDiv({ cls: "vault-lottery-mode-switch" }),
			[
				{ value: "coin", label: "Coin", icon: "coins" },
				{ value: "dice", label: "Dice", icon: "dice-5" },
			],
			this.d.mode,
			(v) => {
				if (this.busy) return;
				this.d.mode = v;
				this.ctx.save();
				this.renderMode();
			},
			"Mode",
		);
		this.stageWrap = container.createDiv({ cls: "vault-lottery-stage-wrap" });
		this.actionsEl = container.createDiv({ cls: "vault-lottery-actions" });
		this.resultEl = container.createDiv({ cls: "vault-lottery-result vault-lottery-dice-result" });
		this.toolsEl = container.createDiv({ cls: "vault-lottery-dice-tools" });
		this.optionsHost = container.createDiv();
		const histBody = collapsible(container, "History", "dice-history", false);
		this.historyEl = histBody.createDiv({ cls: "vault-lottery-history" });
		this.renderMode();
	}

	unmount(): void {
		this.alive = false;
		this.coin?.destroy();
		this.tray?.destroy();
		this.coin = null;
		this.tray = null;
		this.busy = false;
	}

	isBusy(): boolean {
		return this.busy;
	}

	refresh(): void {
		this.coin?.refresh();
		this.tray?.refresh();
	}

	get mode(): "coin" | "dice" {
		return this.d.mode;
	}

	/** Switches mode (if idle) and plays — used by commands when the view is open. */
	playMode(mode: "coin" | "dice"): void {
		if (this.busy) return;
		if (this.d.mode !== mode) {
			this.d.mode = mode;
			this.ctx.save();
			this.renderMode(true);
		}
		this.play();
	}

	handleKey(e: KeyboardEvent): boolean {
		if ((e.key === "r" || e.key === "R") && this.d.mode === "dice") {
			this.rerollUnheld();
			return true;
		}
		return false;
	}

	private setBusy(b: boolean): void {
		this.busy = b;
		for (const el of this.lockables) setLocked(el, b);
		setDisabled(this.playBtn, b || (this.d.mode === "dice" && !this.parsed));
		this.updateReroll();
		this.root?.toggleClass("is-running", b);
		this.ctx.busyChanged();
	}

	// ---------- Layout per mode ----------

	private renderMode(rebuildSwitch = false): void {
		if (rebuildSwitch && this.root) {
			const seg = this.root.querySelector(".vault-lottery-mode-switch");
			seg?.querySelectorAll("button").forEach((b, i) => {
				const active = (i === 0 ? "coin" : "dice") === this.d.mode;
				b.toggleClass("is-active", active);
				b.setAttr("aria-checked", String(active));
			});
		}
		this.coin?.destroy();
		this.tray?.destroy();
		this.coin = null;
		this.tray = null;
		this.stageWrap.empty();
		this.actionsEl.empty();
		this.resultEl.empty();
		this.toolsEl.empty();
		this.optionsHost.empty();
		this.last = null;

		if (this.d.mode === "coin") {
			this.coin = new CoinCanvas(this.stageWrap, {
				images: this.ctx.images,
				faces: () => this.d.coin.faces,
				labels: () => this.d.coin.labels,
				onClick: () => this.play(),
			});
			this.playBtn = this.actionsEl.createEl("button", { cls: "mod-cta vault-lottery-play-btn" });
			setIcon(this.playBtn.createSpan(), "coins");
			this.playBtn.createSpan({ text: "Flip" });
			this.playBtn.addEventListener("click", () => this.play());
			this.rerollBtn = null;
			this.resultEl.createSpan({ cls: "vault-lottery-muted", text: "Flip the coin." });
			this.buildCoinOptions();
		} else {
			this.tray = new DiceTray(this.stageWrap, {
				onStageClick: () => this.play(),
				onDieClick: (i) => this.toggleHold(i),
			});
			this.playBtn = this.actionsEl.createEl("button", { cls: "mod-cta vault-lottery-play-btn" });
			setIcon(this.playBtn.createSpan(), "dices");
			this.playBtn.createSpan({ text: "Roll" });
			this.playBtn.addEventListener("click", () => this.play());
			this.rerollBtn = this.actionsEl.createEl("button", { cls: "vault-lottery-reroll" });
			setIcon(this.rerollBtn.createSpan(), "refresh-cw");
			this.rerollBtn.createSpan({ text: "Reroll" });
			setTooltip(this.rerollBtn, "Reroll unheld dice (R). Tap a die to hold it.");
			this.rerollBtn.addEventListener("click", () => this.rerollUnheld());
			this.buildDiceTools();
			this.buildDiceOptions();
			this.setNotation(this.d.dice.notation, false);
			this.resultEl.createSpan({ cls: "vault-lottery-muted", text: "Roll the dice. Tap a die afterwards to hold it." });
		}
		this.renderHistory();
		this.setBusy(false);
	}

	// ---------- Coin ----------

	private buildCoinOptions(): void {
		const body = collapsible(this.optionsHost, "Coin options", "dice-coin-options", false);
		this.lockables = [body.parentElement as HTMLElement];
		const c = this.d.coin;

		const labels = body.createDiv({ cls: "vault-lottery-coin-labels" });
		const inputs: HTMLInputElement[] = [];
		[0, 1].forEach((i) => {
			const inp = labels.createEl("input", { type: "text", cls: "vault-lottery-grow", attr: { "aria-label": `Side ${i + 1} label`, dir: "auto" } });
			inp.value = c.labels[i];
			inp.addEventListener("input", () => {
				c.labels[i] = inp.value || (i === 0 ? "Heads" : "Tails");
				this.ctx.save();
				this.coin?.refresh();
			});
			inputs.push(inp);
		});
		const presets = body.createDiv({ cls: "vault-lottery-chips" });
		for (const p of LABEL_PRESETS) {
			const b = presets.createEl("button", { cls: "vault-lottery-small-btn", text: `${p[0]} / ${p[1]}` });
			b.addEventListener("click", () => {
				c.labels = [p[0], p[1]];
				inputs[0].value = p[0];
				inputs[1].value = p[1];
				this.ctx.save();
				this.coin?.refresh();
				this.renderHistory();
			});
		}

		[0, 1].forEach((i) => {
			const face = c.faces[i];
			const s = new Setting(body).setName(`Side ${i + 1} face`);
			s.addDropdown((dd) => dd.addOptions({ color: "Color", image: "Image" }).setValue(face.type).onChange(async (v) => {
				if (v === "image" && !face.image) {
					const ref = await cropImage(this.ctx.app, this.ctx.images, { aspect: 1, circle: true, maxSize: 600, title: "Crop coin face" });
					if (!ref) {
						dd.setValue("color");
						return;
					}
					face.image = ref;
				}
				face.type = v as "color" | "image";
				this.ctx.save();
				this.coin?.refresh();
				this.optionsHost.empty();
				this.buildCoinOptions();
			}));
			if (face.type === "color") {
				s.addColorPicker((cp) => cp.setValue(face.color).onChange((v) => {
					face.color = v;
					this.ctx.save();
					this.coin?.refresh();
				}));
			} else {
				s.addButton((b) => b.setButtonText("Image…").onClick(async () => {
					const ref = await cropImage(this.ctx.app, this.ctx.images, { aspect: 1, circle: true, maxSize: 600, title: "Crop coin face" });
					if (!ref) return;
					const old = face.image;
					face.image = ref;
					this.ctx.save();
					this.ctx.plugin.releaseImage(old);
					this.coin?.refresh();
				}));
			}
		});

		new Setting(body).setName("Best of").addDropdown((dd) =>
			dd.addOptions({ "1": "Single", "3": "Best of 3", "5": "Best of 5" }).setValue(String(c.bestOf)).onChange((v) => {
				c.bestOf = parseInt(v) as 1 | 3 | 5;
				this.ctx.save();
			}),
		);
		new Setting(body).setName("Flip duration").setDesc("Seconds").addSlider((sl) =>
			sl.setLimits(0.5, 4, 0.1).setValue(c.durationSec).setDynamicTooltip().onChange((v) => {
				c.durationSec = v;
				this.ctx.save();
			}),
		);
		new Setting(body).setName("Instant mode").setDesc("Skip the animation.").addToggle((t) =>
			t.setValue(c.instant).onChange((v) => {
				c.instant = v;
				this.ctx.save();
			}),
		);
		this.buildSoundOptions(body, "coin");
	}

	private async flipCoin(): Promise<void> {
		const c = this.d.coin;
		const flips = flipSeries(c.bestOf);
		this.setBusy(true);
		const score = [0, 0];
		const per = c.bestOf > 1 ? Math.max(400, c.durationSec * 1000 * 0.6) : c.durationSec * 1000;
		for (let i = 0; i < flips.length; i++) {
			const f = flips[i];
			if (c.instant) {
				this.coin?.show(f);
			} else {
				this.ctx.audio.coinFlip();
				this.resultEl.empty();
				this.resultEl.createSpan({ cls: "vault-lottery-muted", text: flips.length > 1 ? `Flip ${i + 1}…` : "Flipping…" });
				if (c.bestOf > 1) this.renderScore(score);
				await this.coin?.flip(f, per);
				if (!this.alive) return;
			}
			score[f]++;
			session.coin.counts[f]++;
			if (session.coin.streakSide === f) session.coin.streak++;
			else {
				session.coin.streakSide = f;
				session.coin.streak = 1;
			}
			if (!c.instant) {
				this.ctx.audio.coinLand();
				if (c.bestOf > 1) this.renderScore(score);
				if (i < flips.length - 1) await sleep(260);
				if (!this.alive) return;
			}
		}
		if (c.instant) this.ctx.audio.coinLand();
		const text = coinText(this.ctx.plugin.data, flips);
		const winner = seriesWinner(flips);
		this.resultEl.empty();
		const main = this.resultEl.createDiv({ cls: "vault-lottery-result-text", text: c.labels[winner], attr: { dir: "auto" } });
		popIn(main);
		if (flips.length > 1) this.renderScore(score, true);
		addHistory(this.ctx.plugin.data, "coin", text);
		this.ctx.save();
		this.ctx.announce(text);
		this.renderHistory();
		this.setBusy(false);
	}

	private renderScore(score: number[], keep = false): void {
		const l = this.d.coin.labels;
		if (!keep) {
			this.resultEl.querySelector(".vault-lottery-score")?.remove();
		}
		this.resultEl.createDiv({ cls: "vault-lottery-score", text: `${l[0]} ${score[0]} – ${score[1]} ${l[1]}`, attr: { dir: "auto" } });
	}

	// ---------- Dice ----------

	private buildDiceTools(): void {
		const quick = this.toolsEl.createDiv({ cls: "vault-lottery-quick-dice" });
		for (const sides of STANDARD_DICE) {
			const b = quick.createEl("button", { cls: "vault-lottery-die-btn", text: `d${sides}` });
			setTooltip(b, `Add a d${sides} (right-click / long-press removes one)`);
			const lp = onLongPress(b, () => this.changeTray(null, sides, true));
			b.addEventListener("click", (e) => {
				if (consumeLongPressClick(lp, e)) return;
				this.changeTray(null, sides, false);
			});
		}
		for (const cd of this.d.dice.customDice) {
			const b = quick.createEl("button", { cls: "vault-lottery-die-btn is-custom", text: cd.name, attr: { dir: "auto" } });
			setTooltip(b, `Add "${cd.name}" (right-click / long-press removes one)`);
			const lp = onLongPress(b, () => this.changeTray(cd, 0, true));
			b.addEventListener("click", (e) => {
				if (consumeLongPressClick(lp, e)) return;
				this.changeTray(cd, 0, false);
			});
		}
		const row = this.toolsEl.createDiv({ cls: "vault-lottery-notation-row" });
		this.notationInput = row.createEl("input", { type: "text", cls: "vault-lottery-notation", attr: { "aria-label": "Dice notation", spellcheck: "false", autocapitalize: "off", autocomplete: "off" } });
		this.notationInput.placeholder = "e.g. 2d6+3, 4d6kh3";
		this.notationInput.addEventListener("input", () => this.setNotation(this.notationInput?.value ?? "", true, false));
		this.notationInput.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				this.play();
			}
		});
		const clear = row.createEl("button", { cls: "vault-lottery-icon-btn clickable-icon", attr: { "aria-label": "Clear tray" } });
		setIcon(clear, "eraser");
		setTooltip(clear, "Clear tray");
		clear.addEventListener("click", () => this.setNotation("", true));
		this.notationError = this.toolsEl.createDiv({ cls: "vault-lottery-error" });
	}

	private changeTray(custom: CustomDie | null, sides: number, remove: boolean): void {
		if (this.busy) return;
		let p: ParsedNotation | null = this.parsed;
		if (remove) {
			if (!p) return;
			p = removeDie(p, sides, custom?.id);
		} else {
			const next = addDie(p, sides, custom ?? undefined);
			if (next.diceCount > 20) {
				this.showNotationError("At most 20 dice per roll");
				return;
			}
			p = next;
		}
		this.setNotation(p ? formatNotation(p) : "", true);
	}

	private showNotationError(msg: string): void {
		this.notationError?.setText(msg);
		this.notationInput?.toggleClass("is-invalid", !!msg);
	}

	/** Parses and applies notation; keeps the tray in sync. */
	private setNotation(text: string, save: boolean, updateInput = true): void {
		if (updateInput && this.notationInput) this.notationInput.value = text;
		const r = text.trim() ? parseNotation(text, this.d.dice.customDice) : null;
		this.parsed = r && r.ok ? r.value : null;
		this.last = null;
		if (!text.trim()) this.showNotationError("");
		else if (r && !r.ok) this.showNotationError(r.error);
		else this.showNotationError("");
		if (save) {
			this.d.dice.notation = text;
			this.ctx.save();
		}
		this.tray?.setHighlight(null);
		this.tray?.setDice(this.parsed ? this.blankDice(this.parsed) : []);
		setDisabled(this.playBtn, this.busy || !this.parsed, this.parsed ? "" : "Enter valid dice notation");
		this.updateReroll();
	}

	private colorFor(sides: number, custom?: CustomDie): string {
		const key = custom ? custom.id : `d${sides}`;
		return this.d.dice.dieColors[key] || themeColor(this.ctx.viewEl, "--interactive-accent", "#7c3aed");
	}

	private blankDice(p: ParsedNotation): TrayDie[] {
		const out: TrayDie[] = [];
		for (const g of p.groups) {
			for (let k = 0; k < g.count; k++) {
				out.push({ sides: g.sides, customFaces: g.custom?.faces, color: this.colorFor(g.sides, g.custom), value: 0, kept: true, held: false });
			}
		}
		return out;
	}

	private trayDice(p: ParsedNotation, r: RollResult): TrayDie[] {
		return r.dice.map((d) => {
			const g = p.groups[d.group];
			return { sides: d.sides, customFaces: g.custom?.faces, color: this.colorFor(g.sides, g.custom), value: d.value, label: d.label, kept: d.kept, held: d.held };
		});
	}

	private toggleHold(i: number): boolean {
		if (this.busy || !this.last || !this.parsed) return false;
		const d = this.last.dice[i];
		if (!d) return false;
		d.held = !d.held;
		this.tray?.setDice(this.trayDice(this.parsed, this.last));
		this.updateReroll();
		this.ctx.announce(`Die ${i + 1} ${d.held ? "held" : "released"}`);
		return true;
	}

	/** Screen-reader / keyboard toggles mirroring the dice on the canvas (aria-pressed = held). */
	private renderHoldButtons(): void {
		const host = this.stageWrap;
		host.querySelector(".vault-lottery-hold-list")?.remove();
		if (!this.last || !this.parsed) return;
		const list = host.createDiv({ cls: "vault-lottery-sr-only vault-lottery-hold-list", attr: { role: "group", "aria-label": "Hold dice" } });
		this.last.dice.forEach((d, i) => {
			const b = list.createEl("button", { text: `Die ${i + 1}: ${d.label ?? d.value}`, attr: { "aria-pressed": String(d.held) } });
			b.addEventListener("click", () => {
				this.toggleHold(i);
				(this.stageWrap.querySelectorAll<HTMLButtonElement>(".vault-lottery-hold-list button")[i])?.focus();
			});
		});
	}

	private updateReroll(): void {
		this.renderHoldButtons();
		if (!this.rerollBtn) return;
		const can = !this.busy && !!this.last && !!this.parsed && this.last.dice.some((d) => !d.held);
		setDisabled(this.rerollBtn, !can);
		const held = this.last?.dice.filter((d) => d.held).length ?? 0;
		this.rerollBtn.setAttr("aria-pressed", String(held > 0));
	}

	private async rollDice(rerollOnly: boolean): Promise<void> {
		const p = this.parsed;
		if (!p) return;
		const prev = this.last;
		const r = rerollOnly && prev ? reroll(p, prev) : roll(p);
		const final = this.trayDice(p, r);
		this.setBusy(true);
		this.tray?.setHighlight(null);
		if (this.d.dice.instant) {
			this.tray?.setDice(final);
		} else {
			this.ctx.audio.diceRattle(p.diceCount);
			this.resultEl.empty();
			this.resultEl.createSpan({ cls: "vault-lottery-muted", text: "Rolling…" });
			const only = rerollOnly && prev ? new Set(r.dice.map((d, i) => (d.held ? -1 : i)).filter((i) => i >= 0)) : undefined;
			await this.tray?.roll(final, this.d.dice.durationSec * 1000, only);
			if (!this.alive) return;
		}
		this.ctx.audio.diceLand(rerollOnly ? r.dice.filter((d) => !d.held).length : p.diceCount);
		this.last = r;
		this.showDiceResult(p, r);
		this.setBusy(false);
	}

	private showDiceResult(p: ParsedNotation, r: RollResult): void {
		const text = describe(p, r);
		session.dice.rolls++;
		if (r.total !== null) {
			session.dice.totals++;
			session.dice.totalSum += r.total;
		}
		this.resultEl.empty();
		const main = this.resultEl.createDiv({ cls: "vault-lottery-result-text", attr: { dir: "auto" } });
		if (r.total !== null) {
			main.setText(`Total: ${r.total}`);
			const breakdown = text.replace(/^-?\d+\s*/, "");
			if (breakdown) this.resultEl.createDiv({ cls: "vault-lottery-breakdown", text: breakdown, attr: { dir: "auto" } });
		} else {
			main.setText(text);
		}
		const dropped = r.dice.filter((d) => !d.kept).map((d) => d.value);
		if (dropped.length) this.resultEl.createDiv({ cls: "vault-lottery-dropped", text: `Dropped: ${dropped.join(", ")}` });
		popIn(main);
		let tag = "";
		if (isSingleD20(p)) {
			const v = r.dice[0].value;
			if (v === 20) {
				tag = "Critical!";
				this.tray?.setHighlight("crit");
				this.resultEl.createDiv({ cls: "vault-lottery-crit", text: "Critical!" });
			} else if (v === 1) {
				tag = "Fumble";
				this.tray?.setHighlight("fumble");
				this.resultEl.createDiv({ cls: "vault-lottery-fumble", text: "Fumble" });
			}
		}
		const line = `${formatNotation(p)} → ${text}${tag ? ` ${tag}` : ""}`;
		addHistory(this.ctx.plugin.data, "dice", line);
		this.ctx.save();
		this.ctx.announce(r.total !== null ? `Total ${text}${tag ? `. ${tag}` : ""}` : text);
		this.renderHistory();
		this.updateReroll();
	}

	private rerollUnheld(): void {
		if (this.busy || !this.last || !this.parsed) return;
		if (!this.last.dice.some((d) => !d.held)) return;
		void this.rollDice(true);
	}

	private buildDiceOptions(): void {
		const body = collapsible(this.optionsHost, "Dice options", "dice-dice-options", false);
		this.lockables = [body.parentElement as HTMLElement, this.toolsEl];
		const dd = this.d.dice;

		// Custom dice
		body.createDiv({ cls: "vault-lottery-subhead", text: "Custom dice" });
		const list = body.createDiv({ cls: "vault-lottery-custom-dice" });
		const renderCustom = () => {
			list.empty();
			if (!dd.customDice.length) list.createDiv({ cls: "vault-lottery-muted", text: "No custom dice yet. Example — Dinner: Pizza, Sushi, Burger" });
			for (const cd of dd.customDice) this.customDieRow(list, cd, renderCustom);
			const add = list.createEl("button", { cls: "vault-lottery-small-btn" });
			setIcon(add.createSpan(), "plus");
			add.createSpan({ text: " Add custom die" });
			add.addEventListener("click", () => {
				dd.customDice.push({ id: uid(), name: `Custom ${dd.customDice.length + 1}`, faces: ["A", "B"] });
				this.ctx.save();
				renderCustom();
				this.rebuildTools();
			});
		};
		renderCustom();

		// Colors per die type
		body.createDiv({ cls: "vault-lottery-subhead", text: "Die colors" });
		const colors = body.createDiv({ cls: "vault-lottery-die-colors" });
		for (const sides of STANDARD_DICE) {
			const key = `d${sides}`;
			const w = colors.createEl("label", { cls: "vault-lottery-die-color" });
			w.createSpan({ text: key });
			const inp = w.createEl("input", { type: "color" });
			inp.value = dd.dieColors[key] || themeColor(this.ctx.viewEl, "--interactive-accent", "#7c3aed");
			inp.addEventListener("input", () => {
				dd.dieColors[key] = inp.value;
				this.ctx.save();
				this.refreshTrayColors();
			});
		}
		const reset = body.createEl("button", { cls: "mod-muted vault-lottery-small-btn", text: "Reset colors to accent" });
		reset.addEventListener("click", () => {
			dd.dieColors = {};
			this.ctx.save();
			this.optionsHost.empty();
			this.buildDiceOptions();
			this.refreshTrayColors();
		});

		new Setting(body).setName("Roll duration").setDesc("Seconds").addSlider((sl) =>
			sl.setLimits(0.3, 4, 0.1).setValue(dd.durationSec).setDynamicTooltip().onChange((v) => {
				dd.durationSec = v;
				this.ctx.save();
			}),
		);
		new Setting(body).setName("Instant mode").setDesc("Skip the animation.").addToggle((t) =>
			t.setValue(dd.instant).onChange((v) => {
				dd.instant = v;
				this.ctx.save();
			}),
		);
		this.buildSoundOptions(body, "dice");
	}

	private customDieRow(list: HTMLElement, cd: CustomDie, rerender: () => void): void {
		const row = list.createDiv({ cls: "vault-lottery-custom-die" });
		const top = row.createDiv({ cls: "vault-lottery-slice-line" });
		const name = top.createEl("input", { type: "text", cls: "vault-lottery-grow", attr: { "aria-label": "Custom die name", dir: "auto" } });
		name.value = cd.name;
		name.addEventListener("change", () => {
			const v = name.value.trim().replace(/[[\]]/g, "");
			if (!v) {
				name.value = cd.name;
				return;
			}
			const oldName = cd.name;
			cd.name = v;
			// Keep the notation pointing at the renamed die
			const n = this.d.dice.notation.split(`[${oldName}]`).join(`[${v}]`);
			this.d.dice.notation = n;
			this.ctx.save();
			this.rebuildTools();
		});
		const color = top.createEl("input", { type: "color", attr: { "aria-label": "Die color" } });
		color.value = this.d.dice.dieColors[cd.id] || themeColor(this.ctx.viewEl, "--interactive-accent", "#7c3aed");
		color.addEventListener("input", () => {
			this.d.dice.dieColors[cd.id] = color.value;
			this.ctx.save();
			this.refreshTrayColors();
		});
		const del = top.createEl("button", { cls: "vault-lottery-icon-btn clickable-icon vault-lottery-danger", attr: { "aria-label": "Delete custom die" } });
		setIcon(del, "trash-2");
		del.addEventListener("click", () => {
			this.d.dice.customDice = this.d.dice.customDice.filter((x) => x.id !== cd.id);
			delete this.d.dice.dieColors[cd.id];
			this.ctx.save();
			rerender();
			this.rebuildTools();
		});
		const faces = row.createEl("textarea", { cls: "vault-lottery-faces", attr: { "aria-label": "Faces, separated by commas or new lines", dir: "auto", rows: "2" } });
		faces.value = cd.faces.join(", ");
		const hint = row.createDiv({ cls: "vault-lottery-muted vault-lottery-small" });
		const updHint = () => hint.setText(`${cd.faces.length} faces (2–20), separated by commas or new lines`);
		updHint();
		faces.addEventListener("change", () => {
			const parts = faces.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
			if (parts.length < 2) {
				hint.setText("A custom die needs at least 2 faces.");
				return;
			}
			cd.faces = parts;
			faces.value = parts.join(", ");
			this.ctx.save();
			updHint();
			this.setNotation(this.d.dice.notation, false);
		});
	}

	private rebuildTools(): void {
		this.toolsEl.empty();
		this.buildDiceTools();
		this.setNotation(this.d.dice.notation, false);
	}

	private refreshTrayColors(): void {
		if (!this.parsed) return;
		if (this.last) this.tray?.setDice(this.trayDice(this.parsed, this.last));
		else this.tray?.setDice(this.blankDice(this.parsed));
	}

	private buildSoundOptions(body: HTMLElement, kind: "coin" | "dice"): void {
		const s = new Setting(body).setName("Sounds").setDesc(kind === "coin" ? "Coin flip and landing." : "Dice rattle and landing.");
		s.addToggle((t) => t.setValue(this.d.soundsEnabled).onChange((v) => {
			this.d.soundsEnabled = v;
			this.ctx.save();
		}));
		new Setting(body).setClass("vault-lottery-subsetting")
			.addSlider((sl) => sl.setLimits(0, 100, 1).setValue(Math.round(this.d.soundsVolume * 100)).setDynamicTooltip().onChange((v) => {
				this.d.soundsVolume = v / 100;
				this.ctx.save();
			}))
			.addExtraButton((b) => b.setIcon("play").setTooltip(kind === "coin" ? "Preview coin flip" : "Preview dice rattle").onClick(() => {
				if (kind === "coin") this.ctx.audio.coinFlip(true);
				else this.ctx.audio.diceRattle(3, true);
			}))
			.addExtraButton((b) => b.setIcon("volume-2").setTooltip(kind === "coin" ? "Preview coin land" : "Preview dice land").onClick(() => {
				if (kind === "coin") this.ctx.audio.coinLand(true);
				else this.ctx.audio.diceLand(3, true);
			}));
		const more = collapsible(body, "Music & background", `dice-appearance-${kind}`, false);
		const render = () => {
			more.empty();
			buildAudioSlot(more, this.ctx.plugin, "menuMusic", render);
			buildBackground(more, this.ctx.plugin, "dice", render);
		};
		render();
	}

	// ---------- Shared ----------

	play(): void {
		if (this.busy) return;
		this.ctx.audio.unlock();
		if (this.d.mode === "coin") void this.flipCoin();
		else if (this.parsed) void this.rollDice(false);
	}

	/** Prompt-for-notation roll inside the view (used by the "Roll…" command when open). */
	openPrompt(): void {
		new NotationPromptModal(this.ctx.app, this.d.dice.notation, this.d.dice.customDice, (n) => {
			if (this.d.mode !== "dice") {
				this.d.mode = "dice";
				this.renderMode(true);
			}
			this.setNotation(n, true);
			this.play();
		}).open();
	}

	private renderHistory(): void {
		const el = this.historyEl;
		if (!el) return;
		el.empty();
		const mode = this.d.mode;
		const stats = el.createDiv({ cls: "vault-lottery-stats" });
		if (mode === "coin") {
			const l = this.d.coin.labels;
			const s = session.coin;
			stats.createSpan({ text: `${l[0]}: ${s.counts[0]}`, attr: { dir: "auto" } });
			stats.createSpan({ text: `${l[1]}: ${s.counts[1]}`, attr: { dir: "auto" } });
			if (s.streakSide !== null && s.streak > 0) stats.createSpan({ text: `Streak: ${l[s.streakSide]} ×${s.streak}`, attr: { dir: "auto" } });
		} else {
			const s = session.dice;
			stats.createSpan({ text: `Rolls: ${s.rolls}` });
			if (s.totals) stats.createSpan({ text: `Average total: ${(s.totalSum / s.totals).toFixed(1)}` });
		}
		const items = this.d.history.filter((h) => h.mode === mode);
		if (!items.length) {
			el.createDiv({ cls: "vault-lottery-muted", text: "No results yet." });
			return;
		}
		const ul = el.createEl("ul", { cls: "vault-lottery-history-list" });
		for (const h of items) {
			const li = ul.createEl("li");
			li.createSpan({ text: h.text, attr: { dir: "auto" } });
			li.createSpan({ cls: "vault-lottery-muted", text: relativeTime(h.at) });
		}
		const clear = el.createEl("button", { cls: "mod-muted", text: "Clear" });
		clear.addEventListener("click", () => {
			this.d.history = this.d.history.filter((h) => h.mode !== mode);
			if (mode === "coin") session.coin = { counts: [0, 0], streakSide: null, streak: 0 };
			else session.dice = { rolls: 0, totalSum: 0, totals: 0 };
			this.ctx.save();
			this.renderHistory();
		});
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => window.setTimeout(r, ms));
}

function popIn(el: HTMLElement): void {
	el.removeClass("is-pop");
	void el.offsetWidth;
	el.addClass("is-pop");
}
