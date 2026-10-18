// Coin flip with fake 3D: the vertical scale follows cos(angle); the face swaps when it crosses zero.

import type { ImageStore } from "../../images/ImageStore";
import type { CoinFace } from "../../settings";
import { contrastText, shade, themeFont } from "../../shared/color";
import { randomInt } from "../../shared/random";
import { fitText, sizeCanvas } from "../../shared/ui";
import type { Side } from "./diceLogic";

const STAGE_H = 200;

export interface CoinCanvasOptions {
	images: ImageStore;
	faces: () => [CoinFace, CoinFace];
	labels: () => [string, string];
	onClick: () => void;
}

export class CoinCanvas {
	readonly el: HTMLElement;
	private canvas: HTMLCanvasElement;
	private width = 0;
	private face: Side = 0;
	private angle = 0; // 0 = showing `face` flat
	private lift = 0; // 0..1 height
	private wobble = 0;
	private raf: number | null = null;
	private resizeObs: ResizeObserver;
	private font = "sans-serif";
	private shadowColor = "rgba(0,0,0,0.25)";

	constructor(parent: HTMLElement, private o: CoinCanvasOptions) {
		this.el = parent.createDiv({ cls: "vault-lottery-stage vault-lottery-coin-stage", attr: { role: "button", tabindex: "0", "aria-label": "Flip the coin" } });
		this.canvas = this.el.createEl("canvas");
		this.el.addEventListener("click", () => this.o.onClick());
		this.el.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				this.o.onClick();
			}
		});
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(this.el);
		this.readTheme();
	}

	refresh(): void {
		this.readTheme();
		this.draw();
	}

	private readTheme(): void {
		this.font = themeFont(this.el);
		const dark = document.body.hasClass("theme-dark");
		this.shadowColor = dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.22)";
	}

	private resize(): void {
		const w = Math.floor(this.el.clientWidth);
		if (w <= 0 || w === this.width) return;
		this.width = w;
		this.draw();
	}

	get shownFace(): Side {
		return this.face;
	}

	show(face: Side): void {
		this.cancel();
		this.face = face;
		this.angle = 0;
		this.lift = 0;
		this.wobble = 0;
		this.draw();
	}

	/** Flips so that `result` ends up on top. */
	flip(result: Side, durationMs: number): Promise<void> {
		this.cancel();
		const start = this.face;
		let halfTurns = Math.max(3, Math.round((durationMs / 1000) * 7) + randomInt(-1, 1));
		const needOdd = result !== start;
		if ((halfTurns % 2 === 1) !== needOdd) halfTurns++;
		const air = durationMs * 0.82;
		const landMs = durationMs - air;
		const t0 = performance.now();
		return new Promise((resolve) => {
			const step = (now: number) => {
				const el = now - t0;
				if (el < air) {
					const t = el / air;
					const eased = 0.55 * t + 0.45 * (1 - Math.pow(1 - t, 2));
					this.angle = halfTurns * Math.PI * eased;
					this.lift = 4 * t * (1 - t);
					this.wobble = 0;
				} else {
					const k = Math.min(1, (el - air) / landMs);
					this.angle = halfTurns * Math.PI;
					// small bounce and wobble on landing
					this.lift = 0.09 * Math.abs(Math.sin(k * Math.PI * 2)) * (1 - k);
					this.wobble = 0.2 * Math.exp(-4 * k) * Math.abs(Math.sin(k * Math.PI * 4));
				}
				this.draw(start);
				if (el < durationMs) {
					this.raf = window.requestAnimationFrame(step);
				} else {
					this.raf = null;
					this.show(result);
					resolve();
				}
			};
			this.raf = window.requestAnimationFrame(step);
		});
	}

	cancel(): void {
		if (this.raf !== null) window.cancelAnimationFrame(this.raf);
		this.raf = null;
	}

	private draw(startFace: Side = this.face): void {
		const w = this.width;
		if (w <= 0) return;
		const ctx = sizeCanvas(this.canvas, w, STAGE_H);
		if (!ctx) return;
		ctx.clearRect(0, 0, w, STAGE_H);
		const r = Math.min(50, w * 0.18);
		const groundY = STAGE_H - 14;
		const restY = groundY - r - 8;
		const maxLift = Math.max(10, restY - r - 8);
		const cy = restY - this.lift * maxLift;
		const cx = w / 2;
		const cos = Math.cos(this.angle);
		const scaleY = Math.max(0.04, Math.abs(cos) * (1 - this.wobble));
		const face: Side = cos >= 0 ? startFace : ((1 - startFace) as Side);

		// Ground shadow (smaller when higher)
		const sh = 1 - this.lift * 0.6;
		ctx.save();
		ctx.fillStyle = this.shadowColor;
		ctx.beginPath();
		ctx.ellipse(cx, groundY, r * 0.9 * sh, r * 0.18 * sh, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();

		const faceDef = this.o.faces()[face];
		const base = faceDef.color || (face === 0 ? "#d4a017" : "#a8a9ad");
		const ry = r * scaleY;
		// Edge band, visible mostly when near edge-on
		const thick = Math.max(2, r * 0.13 * (1 - scaleY * 0.6));
		ctx.save();
		ctx.fillStyle = shade(base, -0.45);
		ctx.beginPath();
		ctx.ellipse(cx, cy + thick, r, ry, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillRect(cx - r, cy, r * 2, thick);
		ctx.restore();

		// Face
		ctx.save();
		ctx.translate(cx, cy);
		ctx.scale(1, scaleY);
		ctx.beginPath();
		ctx.arc(0, 0, r, 0, Math.PI * 2);
		ctx.closePath();
		const img = faceDef.type === "image" ? this.o.images.get(faceDef.image, () => this.draw()) : null;
		if (img) {
			ctx.save();
			ctx.clip();
			ctx.drawImage(img, -r, -r, r * 2, r * 2);
			ctx.restore();
		} else {
			const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
			g.addColorStop(0, shade(base, 0.45));
			g.addColorStop(0.6, base);
			g.addColorStop(1, shade(base, -0.25));
			ctx.fillStyle = g;
			ctx.fill();
		}
		ctx.lineWidth = Math.max(2, r * 0.06);
		ctx.strokeStyle = shade(base, -0.3);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
		ctx.lineWidth = 1.2;
		ctx.strokeStyle = img ? "rgba(255,255,255,0.5)" : shade(base, -0.18);
		ctx.stroke();
		// Label
		const label = this.o.labels()[face] ?? "";
		if (label) {
			let size = Math.round(r * 0.42);
			ctx.font = `700 ${size}px ${this.font}`;
			while (size > 9 && ctx.measureText(label).width > r * 1.45) {
				size--;
				ctx.font = `700 ${size}px ${this.font}`;
			}
			const text = fitText(ctx, label, r * 1.5);
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			const tc = img ? "#ffffff" : contrastText(base);
			if (img) {
				ctx.shadowColor = "rgba(0,0,0,0.8)";
				ctx.shadowBlur = 4;
			} else {
				ctx.fillStyle = shade(base, tc === "#ffffff" ? -0.4 : 0.5);
				ctx.fillText(text, 1, 2);
			}
			ctx.fillStyle = tc;
			ctx.fillText(text, 0, 1);
		}
		ctx.restore();
	}

	destroy(): void {
		this.cancel();
		this.resizeObs.disconnect();
		this.el.remove();
	}
}
