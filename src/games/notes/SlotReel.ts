// Slot-machine reel of note titles, drawn on a canvas. The strip moves downward and ends with an overshoot bounce.

import { themeColor, themeFont } from "../../shared/color";
import { easeInOutSine, easeOutQuart, fitText, sizeCanvas } from "../../shared/ui";
import { setTextDirection } from "../../shared/bidi";

export interface ReelEntry {
	title: string;
	folder: string;
}

const ROW_H = 48;
const VISIBLE_ROWS = 2.4;
const OVERSHOOT = 0.24;
const BOUNCE_MS = 140;

export class SlotReel {
	readonly frame: HTMLElement;
	private canvas: HTMLCanvasElement;
	private strip: ReelEntry[] = [];
	private pos = 0;
	private speed = 0;
	private message: string | null = null;
	private win = false;
	private raf: number | null = null;
	private resizeObs: ResizeObserver;
	private width = 0;
	private colors = { text: "#222", muted: "#888", accent: "#7c3aed", bg: "#fff" };
	private font = "sans-serif";

	constructor(parent: HTMLElement, onClick: () => void, private onTick: () => void) {
		this.frame = parent.createDiv({ cls: "vault-lottery-reel-frame", attr: { role: "button", tabindex: "0", "aria-label": "Draw a note" } });
		this.frame.createDiv({ cls: "vault-lottery-reel-arrow is-left", attr: { "aria-hidden": "true" } });
		this.frame.createDiv({ cls: "vault-lottery-reel-arrow is-right", attr: { "aria-hidden": "true" } });
		const win = this.frame.createDiv({ cls: "vault-lottery-reel-window" });
		this.canvas = win.createEl("canvas", { cls: "vault-lottery-reel-canvas" });
		this.frame.addEventListener("click", () => onClick());
		this.frame.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				onClick();
			}
		});
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(win);
		this.readTheme();
	}

	refresh(): void {
		this.readTheme();
		this.resize(true);
	}

	private readTheme(): void {
		const el = this.frame;
		this.colors = {
			text: themeColor(el, "--text-normal", "#222222"),
			muted: themeColor(el, "--text-muted", "#888888"),
			accent: themeColor(el, "--interactive-accent", "#7c3aed"),
			bg: themeColor(el, "--background-primary", "#ffffff"),
		};
		this.font = themeFont(el);
	}

	private resize(force = false): void {
		const w = Math.floor(this.canvas.parentElement?.clientWidth ?? 0);
		if (w <= 0 || (!force && w === this.width)) return;
		this.width = w;
		this.draw();
	}

	/** Static display (between draws). */
	setIdle(center: ReelEntry | null, neighbors: ReelEntry[], message: string | null = null): void {
		if (this.raf !== null) return;
		this.message = message;
		this.strip = center ? [neighbors[0] ?? center, center, neighbors[1] ?? center] : [];
		this.pos = 1;
		this.speed = 0;
		this.draw();
	}

	setWin(on: boolean): void {
		this.win = on;
		this.frame.toggleClass("is-win", on);
		this.draw();
	}

	get center(): ReelEntry | null {
		return this.strip[Math.round(this.pos)] ?? null;
	}

	/** Animates through `strip` and stops on `strip[winnerIndex]` (entries after it fill the row above). */
	spin(strip: ReelEntry[], durationMs: number, winnerIndex = strip.length - 1): Promise<void> {
		this.cancel();
		this.message = null;
		this.setWin(false);
		this.strip = strip;
		const N = winnerIndex;
		const mainMs = Math.max(300, durationMs - BOUNCE_MS);
		const t0 = performance.now();
		let lastRow = 0;
		let lastPos = 0;
		let lastT = t0;
		this.pos = 0;
		return new Promise((resolve) => {
			const step = (now: number) => {
				const el = now - t0;
				if (el < mainMs) {
					this.pos = (N + OVERSHOOT) * easeOutQuart(el / mainMs);
				} else {
					const k = Math.min(1, (el - mainMs) / BOUNCE_MS);
					this.pos = N + OVERSHOOT * (1 - easeInOutSine(k));
				}
				const dt = Math.max(1, now - lastT) / 1000;
				this.speed = Math.abs(this.pos - lastPos) / dt;
				lastPos = this.pos;
				lastT = now;
				const row = Math.floor(this.pos);
				if (row !== lastRow && row <= N) {
					lastRow = row;
					this.onTick();
				}
				this.draw();
				if (el < mainMs + BOUNCE_MS) {
					this.raf = window.requestAnimationFrame(step);
				} else {
					this.raf = null;
					this.pos = N;
					this.speed = 0;
					this.draw();
					resolve();
				}
			};
			this.raf = window.requestAnimationFrame(step);
		});
	}

	cancel(): void {
		if (this.raf !== null) window.cancelAnimationFrame(this.raf);
		this.raf = null;
		this.speed = 0;
	}

	private draw(): void {
		const w = this.width;
		if (w <= 0) return;
		const h = Math.round(ROW_H * VISIBLE_ROWS);
		const ctx = sizeCanvas(this.canvas, w, h);
		if (!ctx) return;
		ctx.clearRect(0, 0, w, h);
		const cy = h / 2;
		const padX = 26;
		const maxW = w - padX * 2;

		if (this.message || this.strip.length === 0) {
			ctx.fillStyle = this.colors.muted;
			ctx.font = `500 13px ${this.font}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			setTextDirection(ctx, this.message ?? "");
			ctx.fillText(fitText(ctx, this.message ?? "Press Draw", maxW), w / 2, cy);
			this.drawPayline(ctx, w, cy);
			return;
		}

		const fast = this.speed > 9;
		const base = Math.floor(this.pos);
		for (let k = base - 2; k <= base + 2; k++) {
			const e = this.strip[k];
			if (!e) continue;
			const y = cy + (this.pos - k) * ROW_H;
			if (y < -ROW_H || y > h + ROW_H) continue;
			const dist = Math.abs(y - cy) / ROW_H; // 0 at the payline
			let alpha = Math.max(0.12, 1 - dist * 0.75);
			if (fast && dist > 0.35) alpha *= 0.45;
			ctx.globalAlpha = alpha;
			ctx.textAlign = "center";
			ctx.textBaseline = "alphabetic";
			ctx.fillStyle = this.win && k === Math.round(this.pos) ? this.colors.accent : this.colors.text;
			ctx.font = `600 15px ${this.font}`;
			setTextDirection(ctx, e.title);
			const title = fitText(ctx, e.title, maxW);
			if (fast) {
				// light motion blur: faint copies above/below
				ctx.globalAlpha = alpha * 0.25;
				ctx.fillText(title, w / 2, y - 3);
				ctx.fillText(title, w / 2, y - 9);
				ctx.globalAlpha = alpha;
			}
			ctx.fillText(title, w / 2, y + 1);
			if (e.folder) {
				ctx.font = `400 11px ${this.font}`;
				ctx.fillStyle = this.colors.muted;
				setTextDirection(ctx, e.folder);
				ctx.fillText(fitText(ctx, e.folder, maxW), w / 2, y + 16);
			}
		}
		ctx.globalAlpha = 1;
		// Fade top & bottom
		const g = ctx.createLinearGradient(0, 0, 0, h);
		const bg = this.colors.bg;
		g.addColorStop(0, hexA(bg, 0.85));
		g.addColorStop(0.28, hexA(bg, 0));
		g.addColorStop(0.72, hexA(bg, 0));
		g.addColorStop(1, hexA(bg, 0.85));
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
		this.drawPayline(ctx, w, cy);
	}

	private drawPayline(ctx: CanvasRenderingContext2D, w: number, cy: number): void {
		const half = ROW_H / 2 + 2;
		ctx.save();
		ctx.strokeStyle = this.win ? this.colors.accent : hexA(this.colors.muted, 0.55);
		ctx.lineWidth = this.win ? 2 : 1;
		if (this.win) {
			ctx.shadowColor = this.colors.accent;
			ctx.shadowBlur = 10;
			ctx.fillStyle = hexA(this.colors.accent, 0.1);
			ctx.fillRect(0, cy - half, w, half * 2);
		}
		ctx.beginPath();
		ctx.moveTo(0, cy - half);
		ctx.lineTo(w, cy - half);
		ctx.moveTo(0, cy + half);
		ctx.lineTo(w, cy + half);
		ctx.stroke();
		ctx.restore();
	}

	destroy(): void {
		this.cancel();
		this.resizeObs.disconnect();
		this.frame.remove();
	}
}

function hexA(hex: string, a: number): string {
	const h = hex.replace("#", "");
	if (h.length !== 6) return `rgba(128,128,128,${a})`;
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${a})`;
}
