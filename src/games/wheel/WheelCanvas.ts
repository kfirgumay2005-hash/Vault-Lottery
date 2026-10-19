// Wheel drawing and spin animation. The static wheel is rendered once to an offscreen canvas and rotated per frame.

import type { ImageStore } from "../../images/ImageStore";
import type { Slice } from "../../settings";
import { contrastText, themeColor, themeFont } from "../../shared/color";
import { randomInt, randomRange } from "../../shared/random";
import { easeOutQuart, fitText } from "../../shared/ui";
import { setTextDirection } from "../../shared/bidi";

const TAU = Math.PI * 2;
const MAX_SIDE = 460;

export interface WheelCanvasOptions {
	images: ImageStore;
	onCenterClick: () => void;
	onTick: () => void;
	canSpin: () => boolean;
}

interface LabelSprite {
	canvas: HTMLCanvasElement;
	/** Size in CSS px, the glow padding, the slice's middle angle and the rim-side end of the text. */
	w: number;
	h: number;
	pad: number;
	mid: number;
	outer: number;
}

export class WheelCanvas {
	readonly wrap: HTMLElement;
	readonly canvas: HTMLCanvasElement;
	private slices: Slice[] = [];
	private rotation = 0;
	private highlight: number | null = null;
	private cache: HTMLCanvasElement | null = null;
	private labels: LabelSprite[] = [];
	private side = 0;
	private frame: number | null = null;
	private spinning = false;
	private resizeObs: ResizeObserver;
	private colors = { accent: "#7c3aed", bg: "#ffffff", text: "#222222", border: "#888888" };
	private hubHover = false;
	private font = "sans-serif";

	constructor(parent: HTMLElement, private o: WheelCanvasOptions) {
		this.wrap = parent.createDiv({ cls: "vault-lottery-wheel-wrap" });
		this.canvas = this.wrap.createEl("canvas", { cls: "vault-lottery-wheel-canvas" });
		this.canvas.setAttr("role", "img");
		this.canvas.setAttr("aria-label", "Wheel of fortune");
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(this.wrap);
		this.bindPointer();
		this.readTheme();
	}

	get isSpinning(): boolean {
		return this.spinning;
	}

	setSlices(slices: Slice[]): void {
		this.slices = slices;
		if (this.highlight !== null && this.highlight >= slices.length) this.highlight = null;
		this.invalidate();
	}

	setHighlight(i: number | null): void {
		this.highlight = i;
		this.draw();
	}

	/** Re-reads theme colors (theme change) and redraws. */
	refresh(): void {
		this.readTheme();
		this.resize(true);
	}

	private readTheme(): void {
		const el = this.wrap;
		this.colors = {
			accent: themeColor(el, "--interactive-accent", "#7c3aed"),
			bg: themeColor(el, "--background-primary", "#ffffff"),
			text: themeColor(el, "--text-normal", "#222222"),
			border: themeColor(el, "--background-modifier-border", "#888888"),
		};
		this.font = themeFont(el);
	}

	invalidate(): void {
		this.cache = null;
		this.draw();
	}

	private resize(force = false): void {
		const w = Math.floor(Math.min(this.wrap.clientWidth, MAX_SIDE));
		if (w <= 0) return;
		if (!force && w === this.side) return;
		this.side = w;
		const dpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.round(w * dpr);
		this.canvas.height = Math.round(w * dpr);
		this.canvas.style.width = `${w}px`;
		this.canvas.style.height = `${w}px`;
		this.cache = null;
		this.draw();
	}

	private geom() {
		const W = this.side;
		const R = W / 2 - Math.max(8, W * 0.05);
		return { W, R, cx: W / 2, cy: W / 2, hub: Math.max(18, R * 0.16) };
	}

	private sliceAngle(): number {
		return TAU / Math.max(1, this.slices.length);
	}

	private buildCache(): HTMLCanvasElement | null {
		const { R } = this.geom();
		this.labels = [];
		if (R <= 4) return null;
		const dpr = window.devicePixelRatio || 1;
		const size = Math.ceil((R * 2 + 4) * dpr);
		const c = createEl("canvas");
		c.width = size;
		c.height = size;
		const ctx = c.getContext("2d");
		if (!ctx) return null;
		ctx.scale(dpr, dpr);
		ctx.translate(R + 2, R + 2);
		const n = this.slices.length;
		const s = this.sliceAngle();
		for (let i = 0; i < n; i++) {
			const sl = this.slices[i];
			const a0 = -Math.PI / 2 + i * s;
			const a1 = a0 + s;
			ctx.save();
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.arc(0, 0, R, a0, a1);
			ctx.closePath();
			ctx.fillStyle = sl.color;
			ctx.fill();
			if (sl.fillType === "image" && sl.image) {
				const img = this.o.images.get(sl.image, () => this.invalidate());
				if (img) {
					ctx.clip();
					this.drawWedgeImage(ctx, img, a0 + s / 2, s, R);
				}
			}
			ctx.restore();
		}
		// Borders
		ctx.strokeStyle = "rgba(255,255,255,0.75)";
		ctx.lineWidth = Math.max(1, R * 0.008);
		if (n > 1) {
			for (let i = 0; i < n; i++) {
				const a = -Math.PI / 2 + i * s;
				ctx.beginPath();
				ctx.moveTo(0, 0);
				ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
				ctx.stroke();
			}
		}
		// Labels (drawn per frame, see drawLabels)
		this.labels = [];
		for (let i = 0; i < n; i++) {
			const l = this.buildLabel(this.slices[i], -Math.PI / 2 + i * s + s / 2, s, R);
			if (l) this.labels.push(l);
		}
		// Rim
		ctx.beginPath();
		ctx.arc(0, 0, R, 0, TAU);
		ctx.lineWidth = Math.max(2, R * 0.025);
		ctx.strokeStyle = this.colors.border;
		ctx.stroke();
		// Rim pegs at slice borders (purely decorative)
		if (n <= 36) {
			ctx.fillStyle = this.colors.bg;
			for (let i = 0; i < n; i++) {
				const a = -Math.PI / 2 + i * s;
				ctx.beginPath();
				ctx.arc(Math.cos(a) * (R - R * 0.025), Math.sin(a) * (R - R * 0.025), Math.max(1.5, R * 0.014), 0, TAU);
				ctx.fill();
			}
		}
		return c;
	}

	/** Image clipped to the wedge, covering the wedge's bounding box, with its top towards the rim. */
	private drawWedgeImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, mid: number, s: number, R: number): void {
		ctx.save();
		ctx.rotate(mid + Math.PI / 2); // wedge now points up (-y)
		// Bounding box of the wedge in this frame
		const half = Math.min(s / 2, Math.PI);
		let minX = 0, maxX = 0, minY = 0, maxY = 0;
		const steps = 24;
		for (let k = 0; k <= steps; k++) {
			const a = -Math.PI / 2 - half + (2 * half * k) / steps;
			const x = Math.cos(a) * R;
			const y = Math.sin(a) * R;
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		}
		const bw = maxX - minX;
		const bh = maxY - minY;
		const iw = img.naturalWidth || 1;
		const ih = img.naturalHeight || 1;
		const k = Math.max(bw / iw, bh / ih);
		const dw = iw * k;
		const dh = ih * k;
		ctx.drawImage(img, minX + (bw - dw) / 2, minY + (bh - dh) / 2, dw, dh);
		ctx.restore();
	}

	/**
	 * A slice's label drawn once into its own small canvas (glow included), so every frame can place it upright:
	 * labels that would point left (upside down) are turned half a turn, also while spinning.
	 */
	private buildLabel(sl: Slice, mid: number, s: number, R: number): LabelSprite | null {
		const label = sl.label.trim();
		if (!label) return null;
		const c = createEl("canvas");
		const ctx = c.getContext("2d");
		if (!ctx) return null;
		const outer = R * 0.9;
		const inner = Math.max(R * 0.2, this.geom().hub + 6);
		const maxLen = outer - inner;
		// Font limited by the wedge's height near its inner part and by the radius
		const byAngle = 2 * (inner + maxLen * 0.45) * Math.sin(Math.min(s, Math.PI) / 2) * 0.8;
		// The slice's size setting scales the automatic size, and how far it may shrink to fit long labels
		const scale = Math.max(0.5, Math.min(1.5, sl.textScale ?? 1));
		let size = Math.floor(Math.min(R * 0.13, byAngle, 26) * scale);
		const minSize = Math.max(5, Math.round(9 * scale));
		const fontFor = (px: number) => `600 ${px}px ${this.font}`;
		ctx.font = fontFor(size);
		while (size > minSize && ctx.measureText(label).width > maxLen) {
			size -= 1;
			ctx.font = fontFor(size);
		}
		size = Math.max(5, size);
		ctx.font = fontFor(size);
		const text = fitText(ctx, label, maxLen);
		const glow = Math.max(0, Math.min(1, sl.textGlow ?? 0));
		const pad = Math.ceil(4 + size * 0.9 * glow);
		const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
		const h = Math.ceil(size * 1.4) + pad * 2;
		const dpr = window.devicePixelRatio || 1;
		// Resizing resets the context, so the text state is set after it
		c.width = Math.ceil(w * dpr);
		c.height = Math.ceil(h * dpr);
		ctx.scale(dpr, dpr);
		ctx.font = fontFor(size);
		setTextDirection(ctx, label);
		ctx.textAlign = "right";
		ctx.textBaseline = "middle";
		ctx.fillStyle = sl.textColor || contrastText(sl.color);
		if (glow > 0) {
			// Light halo around the letters; stronger = wider, brighter and drawn more times
			ctx.shadowColor = `rgba(255,255,255,${(0.45 + 0.55 * glow).toFixed(2)})`;
			ctx.shadowBlur = (2 + size * 0.9 * glow) * dpr;
			const passes = 1 + Math.round(glow * 2);
			for (let k = 0; k < passes; k++) ctx.fillText(text, w - pad, h / 2);
		} else {
			ctx.fillText(text, w - pad, h / 2);
		}
		return { canvas: c, w, h, pad, mid, outer };
	}

	/** Labels on top of the cached wheel (ctx already turned with the wheel), each kept upright. */
	private drawLabels(ctx: CanvasRenderingContext2D): void {
		for (const l of this.labels) {
			const a = this.rotation + l.mid;
			// Text runs outwards along the radius; pointing left means upside down
			const flip = Math.cos(a) < 0;
			ctx.save();
			ctx.rotate(flip ? l.mid + Math.PI : l.mid);
			// Anchored at the rim either way: normally its end, flipped its start
			const x = flip ? -l.outer - l.pad : l.outer - (l.w - l.pad);
			ctx.drawImage(l.canvas, x, -l.h / 2, l.w, l.h);
			ctx.restore();
		}
	}

	draw(): void {
		const { W, R, cx, cy, hub } = this.geom();
		if (W <= 0) return;
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, W, W);
		if (!this.cache) this.cache = this.buildCache();
		// Shadow under the wheel
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy + R * 0.02, R, 0, TAU);
		ctx.shadowColor = "rgba(0,0,0,0.28)";
		ctx.shadowBlur = R * 0.08;
		ctx.fillStyle = this.colors.bg;
		ctx.fill();
		ctx.restore();

		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.rotation);
		if (this.cache) ctx.drawImage(this.cache, -(R + 2), -(R + 2), (R + 2) * 2, (R + 2) * 2);
		this.drawLabels(ctx);
		if (this.highlight !== null && this.slices.length > 0) {
			const s = this.sliceAngle();
			const a0 = -Math.PI / 2 + this.highlight * s;
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.arc(0, 0, R - 1, a0, a0 + s);
			ctx.closePath();
			ctx.fillStyle = "rgba(255,255,255,0.14)";
			ctx.fill();
			ctx.shadowColor = "rgba(255,255,255,0.9)";
			ctx.shadowBlur = 14;
			ctx.lineWidth = Math.max(2, R * 0.022);
			ctx.strokeStyle = "#ffffff";
			ctx.lineJoin = "round";
			ctx.stroke();
		}
		ctx.restore();

		// Hub (click to spin)
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, hub, 0, TAU);
		ctx.fillStyle = this.colors.bg;
		ctx.shadowColor = "rgba(0,0,0,0.3)";
		ctx.shadowBlur = 6;
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.lineWidth = Math.max(2, hub * 0.12);
		ctx.strokeStyle = this.hubHover && this.o.canSpin() ? this.colors.accent : this.colors.border;
		ctx.stroke();
		ctx.fillStyle = this.o.canSpin() ? this.colors.accent : this.colors.border;
		ctx.font = `700 ${Math.max(9, Math.round(hub * 0.5))}px ${this.font}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("SPIN", cx, cy + 1);
		ctx.restore();

		// Pointer at 12 o'clock
		const pw = Math.max(12, R * 0.12);
		const ph = Math.max(14, R * 0.15);
		const top = cy - R - Math.max(4, R * 0.04);
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(cx - pw / 2, top);
		ctx.lineTo(cx + pw / 2, top);
		ctx.lineTo(cx, top + ph);
		ctx.closePath();
		ctx.shadowColor = "rgba(0,0,0,0.35)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetY = 1;
		ctx.fillStyle = this.colors.accent;
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = this.colors.bg;
		ctx.stroke();
		ctx.restore();
	}

	private bindPointer(): void {
		const inHub = (e: PointerEvent | MouseEvent) => {
			const b = this.canvas.getBoundingClientRect();
			const { cx, cy, hub } = this.geom();
			const x = e.clientX - b.left;
			const y = e.clientY - b.top;
			return Math.hypot(x - cx, y - cy) <= hub * 1.15;
		};
		this.canvas.addEventListener("click", (e) => {
			if (inHub(e)) this.o.onCenterClick();
		});
		this.canvas.addEventListener("pointermove", (e) => {
			const h = inHub(e);
			if (h !== this.hubHover) {
				this.hubHover = h;
				this.canvas.style.cursor = h && this.o.canSpin() ? "pointer" : "";
				if (!this.spinning) this.draw();
			}
		});
		this.canvas.addEventListener("pointerleave", () => {
			if (this.hubHover) {
				this.hubHover = false;
				if (!this.spinning) this.draw();
			}
		});
	}

	/** Spins so the pointer lands at a random spot inside slice `winner` (not on a border). */
	spin(winner: number, durationMs: number): Promise<void> {
		this.cancel();
		const n = this.slices.length;
		const s = TAU / n;
		const f = randomRange(0.12, 0.88); // position inside the wedge
		const target = (((-(winner + f) * s) % TAU) + TAU) % TAU;
		const start = this.rotation;
		const startMod = ((start % TAU) + TAU) % TAU;
		const turns = randomInt(5, 8);
		const delta = turns * TAU + ((target - startMod + TAU) % TAU);
		const t0 = performance.now();
		this.highlight = null;
		this.spinning = true;
		let lastBorder = Math.floor(start / s);
		return new Promise((resolve) => {
			const step = (now: number) => {
				const t = Math.min(1, (now - t0) / durationMs);
				this.rotation = start + delta * easeOutQuart(t);
				const border = Math.floor(this.rotation / s);
				if (border !== lastBorder) {
					lastBorder = border;
					this.o.onTick();
				}
				this.draw();
				if (t < 1) {
					this.frame = window.requestAnimationFrame(step);
				} else {
					this.frame = null;
					this.spinning = false;
					// keep the angle small so float precision never suffers over many spins
					this.rotation = ((this.rotation % TAU) + TAU) % TAU;
					this.highlight = winner;
					this.draw();
					resolve();
				}
			};
			this.frame = window.requestAnimationFrame(step);
		});
	}

	cancel(): void {
		if (this.frame !== null) window.cancelAnimationFrame(this.frame);
		this.frame = null;
		this.spinning = false;
	}

	/** Index of the slice currently under the pointer. */
	sliceAtPointer(): number {
		const n = this.slices.length;
		if (!n) return -1;
		const s = TAU / n;
		const a = (((-this.rotation) % TAU) + TAU) % TAU;
		return Math.min(n - 1, Math.floor(a / s));
	}

	destroy(): void {
		this.cancel();
		this.resizeObs.disconnect();
		this.wrap.remove();
	}
}
