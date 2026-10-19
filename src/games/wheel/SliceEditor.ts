// Slice editor: label, color / image fill, text color, glow and size, own end sound, reorder, delete.

import { Menu, Platform, setIcon, setTooltip } from "obsidian";
import { cropImage, wedgeAspect } from "../../images/CropModal";
import type VaultLotteryPlugin from "../../main";
import { makeSlice, type ImageRef, type Slice } from "../../settings";
import { AUDIO_EXTENSIONS } from "../../shared/AudioManager";
import { addDeviceFile } from "../../shared/appearance";
import { SLICE_PALETTE, contrastText } from "../../shared/color";
import { pickFile } from "../../shared/modals";
import { iconButton, setDisabled } from "../../shared/ui";

export const MIN_SLICES = 2;
export const MAX_SLICES = 50;

export class SliceEditor {
	readonly el: HTMLElement;
	private listEl: HTMLElement;
	private addBtn: HTMLButtonElement;
	private countEl: HTMLElement;

	constructor(
		parent: HTMLElement,
		private plugin: VaultLotteryPlugin,
		private onChange: (structural: boolean) => void,
	) {
		this.el = parent.createDiv({ cls: "vault-lottery-slice-editor" });
		this.listEl = this.el.createDiv({ cls: "vault-lottery-slice-list" });
		const footer = this.el.createDiv({ cls: "vault-lottery-row" });
		this.addBtn = footer.createEl("button", { cls: "mod-cta vault-lottery-add" });
		setIcon(this.addBtn.createSpan(), "plus");
		this.addBtn.createSpan({ text: "Add slice" });
		this.addBtn.addEventListener("click", () => this.add());
		this.countEl = footer.createSpan({ cls: "vault-lottery-muted" });
		this.render();
	}

	private get slices(): Slice[] {
		return this.plugin.data.wheel.workingSlices;
	}

	render(): void {
		this.listEl.empty();
		this.slices.forEach((s, i) => this.renderRow(s, i));
		setDisabled(this.addBtn, this.slices.length >= MAX_SLICES, `Maximum ${MAX_SLICES} slices`);
		this.countEl.setText(`${this.slices.length} / ${MAX_SLICES}`);
	}

	private renderRow(s: Slice, i: number): void {
		const row = this.listEl.createDiv({ cls: "vault-lottery-slice-row" });
		row.style.setProperty("--vl-slice-color", s.color);
		const line1 = row.createDiv({ cls: "vault-lottery-slice-line" });
		const swatch = line1.createDiv({ cls: "vault-lottery-slice-swatch" });
		if (s.fillType === "image" && s.image) {
			swatch.addClass("is-image");
			swatch.style.backgroundImage = `url("${this.plugin.images.url(s.image).replace(/"/g, '\\"')}")`;
		}
		const label = line1.createEl("input", { type: "text", cls: "vault-lottery-slice-label" });
		label.value = s.label;
		label.placeholder = `Slice ${i + 1}`;
		label.setAttr("dir", "auto");
		label.setAttr("aria-label", `Slice ${i + 1} label`);
		label.addEventListener("input", () => {
			s.label = label.value;
			this.onChange(false);
		});
		const up = iconButton(line1, "arrow-up", "Move up", () => this.move(i, -1));
		const down = iconButton(line1, "arrow-down", "Move down", () => this.move(i, 1));
		setDisabled(up, i === 0);
		setDisabled(down, i === this.slices.length - 1);

		const line2 = row.createDiv({ cls: "vault-lottery-slice-line vault-lottery-slice-tools" });
		const toggle = line2.createDiv({ cls: "vault-lottery-mini-seg", attr: { role: "radiogroup", "aria-label": "Fill type" } });
		const colorBtn = toggle.createEl("button", { attr: { role: "radio", "aria-label": "Color fill" } });
		setIcon(colorBtn, "palette");
		setTooltip(colorBtn, "Color fill");
		const imgBtn = toggle.createEl("button", { attr: { role: "radio", "aria-label": "Image fill" } });
		setIcon(imgBtn, "image");
		setTooltip(imgBtn, "Image fill");
		const setSeg = () => {
			colorBtn.toggleClass("is-active", s.fillType === "color");
			imgBtn.toggleClass("is-active", s.fillType === "image");
			colorBtn.setAttr("aria-checked", String(s.fillType === "color"));
			imgBtn.setAttr("aria-checked", String(s.fillType === "image"));
		};
		setSeg();
		colorBtn.addEventListener("click", () => {
			if (s.fillType === "color") return;
			s.fillType = "color";
			this.onChange(true);
			this.render();
		});
		imgBtn.addEventListener("click", () => {
			if (s.fillType === "image" && s.image) return;
			if (s.image) {
				s.fillType = "image";
				this.onChange(true);
				this.render();
			} else {
				void this.chooseImage(s);
			}
		});

		if (s.fillType === "color") {
			const fill = line2.createEl("input", { type: "color", cls: "vault-lottery-color" });
			fill.value = s.color;
			fill.setAttr("aria-label", "Slice color");
			setTooltip(fill, "Slice color");
			fill.addEventListener("input", () => {
				const autoBefore = s.textColor === contrastText(s.color);
				s.color = fill.value;
				if (autoBefore) {
					s.textColor = contrastText(s.color);
					text.value = s.textColor;
				}
				row.style.setProperty("--vl-slice-color", s.color);
				this.onChange(false);
			});
		} else {
			iconButton(line2, "image-plus", "Choose another image", () => void this.chooseImage(s));
			iconButton(line2, "image-off", "Remove image", () => this.removeImage(s));
		}
		const textWrap = line2.createDiv({ cls: "vault-lottery-text-color has-glow-slider" });
		const tIcon = textWrap.createSpan({ cls: "vault-lottery-text-color-icon" });
		setIcon(tIcon, "type");
		const text = textWrap.createEl("input", { type: "color", cls: "vault-lottery-color" });
		text.value = s.textColor || contrastText(s.color);
		text.setAttr("aria-label", "Text color");
		setTooltip(textWrap, "Text color");
		text.addEventListener("input", () => {
			s.textColor = text.value;
			this.onChange(false);
		});
		const glow = textWrap.createEl("input", { type: "range", cls: "vault-lottery-glow-slider", attr: { "aria-label": "Text glow" } });
		glow.min = "0";
		glow.max = "100";
		glow.step = "1";
		glow.value = String(Math.round((s.textGlow ?? 0) * 100));
		setTooltip(glow, "Text glow (drag right for a brighter glow)");
		glow.addEventListener("input", () => {
			s.textGlow = parseInt(glow.value, 10) / 100;
			this.onChange(false);
		});
		const sizeWrap = line2.createDiv({ cls: "vault-lottery-text-color has-glow-slider" });
		const sIcon = sizeWrap.createSpan({ cls: "vault-lottery-text-color-icon" });
		setIcon(sIcon, "a-large-small");
		const size = sizeWrap.createEl("input", { type: "range", cls: "vault-lottery-glow-slider", attr: { "aria-label": "Text size" } });
		size.min = "50";
		size.max = "150";
		size.step = "5";
		size.value = String(Math.round((s.textScale ?? 1) * 100));
		const sizeTip = () => setTooltip(size, `Text size: ${size.value}% (smaller fits long labels; double-click resets)`);
		sizeTip();
		size.addEventListener("input", () => {
			s.textScale = parseInt(size.value, 10) / 100;
			sizeTip();
			this.onChange(false);
		});
		size.addEventListener("dblclick", () => {
			size.value = "100";
			s.textScale = 1;
			sizeTip();
			this.onChange(false);
		});
		const soundName = s.sound?.split("/").pop();
		const sound = iconButton(
			line2,
			"music",
			s.sound ? `Sound when this slice wins: ${soundName} (instead of the end sound)` : "Sound when this slice wins",
			() => this.soundMenu(s, sound),
			s.sound ? "is-active" : "",
		);
		sound.setAttr("aria-haspopup", "menu");
		line2.createDiv({ cls: "vault-lottery-spacer", attr: { "aria-hidden": "true" } });
		iconButton(line2, "trash-2", "Delete slice", () => this.remove(i), "vault-lottery-danger");
	}

	private async chooseImage(s: Slice): Promise<void> {
		// Crop to the slice's own wedge shape (the image covers the wedge on the wheel)
		const angle = (Math.PI * 2) / Math.max(MIN_SLICES, this.slices.length);
		const ref = await cropImage(this.plugin.app, this.plugin.images, {
			aspect: wedgeAspect(angle),
			wedge: angle,
			maxSize: 800,
			title: "Crop slice image",
		});
		if (!ref) return;
		const old: ImageRef | undefined = s.image;
		s.image = ref;
		s.fillType = "image";
		this.onChange(true);
		this.plugin.releaseImage(old);
		this.render();
	}

	/** Choose, preview or clear the slice's own sound (it replaces the end sound when the slice wins). */
	private soundMenu(s: Slice, anchor: HTMLElement): void {
		const use = (path: string) => {
			const old = s.sound;
			s.sound = path;
			this.onChange(false);
			if (old) this.plugin.scheduleMediaGc();
			this.render();
		};
		const menu = new Menu();
		menu.addItem((it) =>
			it.setTitle("Sound from vault…").setIcon("folder-open").onClick(async () => {
				const f = await pickFile(this.plugin.app, AUDIO_EXTENSIONS, "Choose an audio file (mp3, wav, ogg, m4a, flac)…");
				if (f) use(f.path);
			}),
		);
		menu.addItem((it) =>
			it.setTitle(Platform.isMobile ? "Sound from device…" : "Sound from computer…").setIcon("upload").onClick(async () => {
				const path = await addDeviceFile(this.plugin, "audio/*,.mp3,.wav,.ogg,.m4a,.flac");
				if (path) use(path);
			}),
		);
		if (s.sound) {
			const path = s.sound;
			menu.addSeparator();
			menu.addItem((it) => it.setTitle("Preview").setIcon("play").onClick(() => this.plugin.audio.previewFile(path)));
			menu.addItem((it) =>
				it.setTitle("Remove sound (use the end sound)").setIcon("x").onClick(() => {
					this.plugin.audio.stopPreview();
					delete s.sound;
					this.onChange(false);
					this.plugin.scheduleMediaGc();
					this.render();
				}),
			);
		}
		const r = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom });
	}

	/** Back to a color fill, and let the image file go. */
	private removeImage(s: Slice): void {
		const old = s.image;
		s.image = undefined;
		s.fillType = "color";
		this.onChange(true);
		this.plugin.releaseImage(old);
		this.render();
	}

	private add(): void {
		if (this.slices.length >= MAX_SLICES) return;
		const used = new Set(this.slices.map((s) => s.color.toLowerCase()));
		const next = SLICE_PALETTE.find((c) => !used.has(c.toLowerCase()));
		const s = makeSlice(this.slices.length);
		if (next) {
			s.color = next;
			s.textColor = contrastText(next);
		}
		this.slices.push(s);
		this.onChange(true);
		this.render();
		const inputs = this.listEl.querySelectorAll<HTMLInputElement>(".vault-lottery-slice-label");
		const last = inputs[inputs.length - 1];
		last?.focus();
		last?.select();
	}

	private remove(i: number): void {
		const [removed] = this.slices.splice(i, 1);
		this.onChange(true);
		this.plugin.releaseImage(removed?.image);
		if (removed?.sound) this.plugin.scheduleMediaGc();
		this.render();
	}

	private move(i: number, dir: number): void {
		const j = i + dir;
		if (j < 0 || j >= this.slices.length) return;
		const [s] = this.slices.splice(i, 1);
		this.slices.splice(j, 0, s);
		this.onChange(true);
		this.render();
	}
}
