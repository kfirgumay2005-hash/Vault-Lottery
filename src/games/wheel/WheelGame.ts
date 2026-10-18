// Spin Wheel game.

import { Setting, setIcon } from "obsidian";
import type { Game, GameContext } from "../Game";
import { soundAppearanceSection, buildTickOverride } from "../../shared/appearance";
import { paintBackground } from "../../shared/background";
import { randomInt } from "../../shared/random";
import { SavedSetBar } from "../../shared/SavedSetBar";
import { collapsible, setDisabled, setLocked } from "../../shared/ui";
import { PresetManager } from "./PresetManager";
import { MIN_SLICES, SliceEditor } from "./SliceEditor";
import { WheelCanvas } from "./WheelCanvas";

export class WheelGame implements Game {
	id = "wheel";
	name = "Spin Wheel";
	icon = "disc-3";

	private wheel: WheelCanvas | null = null;
	private bgEl: HTMLElement | null = null;
	private spinBtn: HTMLButtonElement | null = null;
	private resultEl: HTMLElement | null = null;
	private bar: SavedSetBar | null = null;
	private editor: SliceEditor | null = null;
	private lockables: HTMLElement[] = [];
	private presets: PresetManager;
	private busy = false;
	private alive = false;

	constructor(private ctx: GameContext) {
		this.presets = new PresetManager(ctx.plugin);
	}

	private get data() {
		return this.ctx.plugin.data.wheel;
	}

	mount(container: HTMLElement): void {
		this.alive = true;
		const stage = container.createDiv({ cls: "vault-lottery-wheel-stage" });
		this.wheel = new WheelCanvas(stage, {
			images: this.ctx.images,
			onCenterClick: () => this.play(),
			onTick: () => this.ctx.audio.tick(this.data.tickSoundOverride),
			canSpin: () => this.canSpin(),
		});
		// "Wheel area only" background: a layer behind the wheel, never over the slices
		this.bgEl = this.wheel.wrap.createDiv({ cls: "vault-lottery-wheel-bg" });
		this.wheel.wrap.prepend(this.bgEl);
		this.wheel.setSlices(this.data.workingSlices);

		this.spinBtn = stage.createEl("button", { cls: "mod-cta vault-lottery-play-btn" });
		setIcon(this.spinBtn.createSpan(), "rotate-cw");
		this.spinBtn.createSpan({ text: "Spin" });
		this.spinBtn.addEventListener("click", () => this.play());

		this.resultEl = container.createDiv({ cls: "vault-lottery-result vault-lottery-wheel-result", attr: { "aria-live": "off" } });
		this.resultEl.createSpan({ cls: "vault-lottery-muted", text: "Press Spin to pick a slice." });

		const barWrap = container.createDiv({ cls: "vault-lottery-block" });
		this.bar = new SavedSetBar(barWrap, this.ctx.app, this.presets.adapter(() => this.onPresetLoaded()));

		const editorBody = collapsible(container, "Slices", "wheel-slices", true);
		this.editor = new SliceEditor(editorBody, this.ctx.plugin, (structural) => this.onSlicesChanged(structural));

		const appearance = soundAppearanceSection(container, this.ctx.plugin, "wheel", (el) => {
			new Setting(el).setName("Spin duration").setDesc("Seconds").addSlider((s) =>
				s.setLimits(2, 15, 1).setValue(this.data.spinDurationSec).setDynamicTooltip().onChange((v) => {
					this.data.spinDurationSec = v;
					this.ctx.save();
				}),
			);
			buildTickOverride(el, this.ctx.plugin, () => this.data.tickSoundOverride, (v) => (this.data.tickSoundOverride = v));
			new Setting(el).setName("Confetti").setDesc("Celebrate each result.").addToggle((t) =>
				t.setValue(this.data.confetti).onChange((v) => {
					this.data.confetti = v;
					this.ctx.save();
				}),
			);
		});

		this.lockables = [barWrap, editorBody.parentElement as HTMLElement, appearance.parentElement as HTMLElement];
		this.updateSpinState();
	}

	unmount(): void {
		this.alive = false;
		this.wheel?.destroy();
		this.wheel = null;
		this.busy = false;
	}

	isBusy(): boolean {
		return this.busy;
	}

	refresh(): void {
		this.wheel?.refresh();
	}

	backgroundChanged(): void {
		if (!this.bgEl) return;
		const bg = this.data.background;
		paintBackground(this.bgEl, bg.scope === "wheel" ? bg : null, this.ctx.images, this.ctx.app);
		this.wheel?.wrap.toggleClass("has-bg", bg.scope === "wheel" && bg.type !== "none");
	}

	private canSpin(): boolean {
		return !this.busy && this.data.workingSlices.length >= MIN_SLICES;
	}

	private updateSpinState(): void {
		const few = this.data.workingSlices.length < MIN_SLICES;
		setDisabled(this.spinBtn, this.busy || few, few ? `Add at least ${MIN_SLICES} slices to spin` : "");
		this.wheel?.draw();
	}

	private onSlicesChanged(structural: boolean): void {
		this.wheel?.setSlices(this.data.workingSlices);
		if (structural) this.wheel?.setHighlight(null);
		this.ctx.save();
		this.bar?.update();
		this.updateSpinState();
	}

	private onPresetLoaded(): void {
		this.wheel?.setSlices(this.data.workingSlices);
		this.wheel?.setHighlight(null);
		this.editor?.render();
		this.updateSpinState();
		this.resultEl?.empty();
	}

	/** Loads a preset by id (command palette). */
	loadPreset(id: string): void {
		if (this.busy) return;
		if (this.presets.load(id)) {
			this.onPresetLoaded();
			this.bar?.update();
		}
	}

	private setBusy(b: boolean): void {
		this.busy = b;
		for (const el of this.lockables) setLocked(el, b);
		this.updateSpinState();
		this.ctx.busyChanged();
	}

	play(): void {
		if (!this.wheel || !this.canSpin()) return;
		const slices = this.data.workingSlices.slice();
		const winner = randomInt(0, slices.length - 1);
		this.setBusy(true);
		this.ctx.audio.gameStart();
		this.resultEl?.empty();
		this.resultEl?.createSpan({ cls: "vault-lottery-muted", text: "Spinning…" });
		void this.wheel.spin(winner, this.data.spinDurationSec * 1000).then(() => {
			if (!this.alive) return;
			const s = slices[winner];
			this.ctx.audio.gameEnd();
			this.showResult(s.label || `Slice ${winner + 1}`, s.color);
			this.setBusy(false);
			this.ctx.announce(`Result: ${s.label}`);
			if (this.data.confetti && this.wheel) {
				this.ctx.celebrate(this.wheel.canvas, [s.color], this.resultEl);
			}
		});
	}

	private showResult(label: string, color: string): void {
		const el = this.resultEl;
		if (!el) return;
		el.empty();
		const t = el.createDiv({ cls: "vault-lottery-result-text", text: label, attr: { dir: "auto" } });
		t.style.setProperty("--vl-result-color", color);
		el.removeClass("is-pop");
		void el.offsetWidth;
		el.addClass("is-pop");
	}
}
