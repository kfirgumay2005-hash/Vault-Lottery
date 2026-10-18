// Dice drawing and the roll animation (tumble, flicker, settle with a bounce). Dice never overlap at rest.

import { contrastText, shade, themeColor, themeFont } from "../../shared/color";
import { randomInt, randomRange } from "../../shared/random";
import { easeOutCubic, fitText, roundRect, sizeCanvas } from "../../shared/ui";

export interface TrayDie {
	sides: number;
	customFaces?: string[];
	color: string;
	value: number; // 0 = blank (not rolled yet)
	label?: string;
	kept: boolean;
	held: boolean;
}

interface Anim {
	sx: number;
	sy: number;
	rot0: number;
	jitter: number;
	flickerAt: number;
	shown: number;
}

const MIN_H = 150;
const GAP = 12;

export interface DiceTrayOptions {
	onStageClick: () => void;
	onDieClick: (index: number) => boolean; // return true if handled (hold toggled)
}

export class DiceTray {
	readonly el: HTMLElement;
	private canvas: HTMLCanvasElement;
	private dice: TrayDie[] = [];
	private width = 0;
	private height = MIN_H;
	private raf: number | null = null;
	private anim: Map<number, Anim> | null = null;
	private progress = 1;
	private highlight: "crit" | "fumble" | null = null;
	private resizeObs: ResizeObserver;
	private colors = { accent: "#7c3aed", muted: "#888", text: "#222", fumble: "#d04040", bg: "#fff" };
	private font = "sans-serif";

	constructor(parent: HTMLElement, private o: DiceTrayOptions) {
		this.el = parent.createDiv({ cls: "vault-lottery-stage vault-lottery-dice-stage", attr: { role: "button", tabindex: "0", "aria-label": "Roll the dice" } });
		this.canvas = this.el.createEl("canvas");
		this.el.addEventListener("click", (e) => this.onClick(e));
		this.el.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				this.o.onStageClick();
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
		const el = this.el;
		this.colors = {
			accent: themeColor(el, "--interactive-accent", "#7c3aed"),
			muted: themeColor(el, "--text-muted", "#888888"),
			text: themeColor(el, "--text-normal", "#222222"),
			fumble: themeColor(el, "--text-error", "#d04040"),
			bg: themeColor(el, "--background-primary", "#ffffff"),
		};
		this.font = themeFont(el);
	}

	get isAnimating(): boolean {
		return this.raf !== null;
	}

	private resize(): void {
		const w = Math.floor(this.el.clientWidth);
		if (w <= 0 || w === this.width) return;
		this.width = w;
		this.draw();
	}

	setDice(dice: TrayDie[]): void {
		this.cancel();
		this.dice = dice;
		this.progress = 1;
		this.anim = null;
		this.draw();
	}

	setHighlight(h: "crit" | "fumble" | null): void {
		this.highlight = h;
		this.draw();
	}

	/** Layout: die size and rest positions (centered grid, wraps to rows). */
	private layout(): { size: number; pos: { x: number; y: number }[]; height: number } {
		const n = this.dice.length;
		const w = Math.max(100, this.width);
		const size = n > 12 ? 44 : n > 6 ? 50 : 58;
		const cols = Math.max(1, Math.min(n, Math.floor((w - GAP) / (size + GAP))));
		const rows = Math.max(1, Math.ceil(n / cols));
		const height = Math.max(MIN_H, rows * (size + GAP) + GAP + 24);
		const top = (height - rows * (size + GAP) + GAP) / 2;
		const pos: { x: number; y: number }[] = [];
		for (let i = 0; i < n; i++) {
			const r = Math.floor(i / cols);
			const inRow = r === rows - 1 ? n - r * cols : cols;
			const c = i % cols;
			const left = (w - inRow * (size + GAP) + GAP) / 2;
			pos.push({ x: left + c * (size + GAP) + size / 2, y: top + r * (size + GAP) + size / 2 });
		}
		return { size, pos, height };
	}

	/** Animates the given dice (all, or only the indices in `only`) to their final values. */
	roll(final: TrayDie[], durationMs: number, only?: Set<number>): Promise<void> {
		this.cancel();
		this.highlight = null;
		this.dice = final;
		const { pos, size } = this.layout();
		const anim = new Map<number, Anim>();
		final.forEach((d, i) => {
			if (only && !only.has(i)) return;
			const p = pos[i];
			anim.set(i, {
				sx: p.x + randomRange(-1, 1) * Math.max(40, this.width * 0.35),
				sy: p.y + randomRange(-1, 0.4) * size * 1.6,
				rot0: randomRange(2, 4.5) * Math.PI * (randomInt(0, 1) ? 1 : -1),
				jitter: randomRange(4, 10),
				flickerAt: 0,
				shown: randomInt(1, d.sides),
			});
		});
		this.anim = anim;
		const t0 = performance.now();
		return new Promise((resolve) => {
			const step = (now: number) => {
				const t = Math.min(1, (now - t0) / durationMs);
				this.progress = t;
				// Faces flicker, slowing down
				for (const [i, a] of anim) {
					if (t < 0.82 && now >= a.flickerAt) {
						a.shown = randomInt(1, final[i].sides);
						a.flickerAt = now + 45 + t * 160;
					} else if (t >= 0.82) {
						a.shown = final[i].value;
					}
				}
				this.draw();
				if (t < 1) {
					this.raf = window.requestAnimationFrame(step);
				} else {
					this.raf = null;
					this.anim = null;
					this.progress = 1;
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
		this.anim = null;
		this.progress = 1;
	}

	private onClick(e: MouseEvent): void {
		if (this.raf === null) {
			const b = this.canvas.getBoundingClientRect();
			const x = e.clientX - b.left;
			const y = e.clientY - b.top;
			const { pos, size } = this.layout();
			const i = pos.findIndex((p) => Math.abs(p.x - x) <= size / 2 + 4 && Math.abs(p.y - y) <= size / 2 + 4);
			if (i >= 0 && this.o.onDieClick(i)) return;
		}
		this.o.onStageClick();
	}

	draw(): void {
		const w = this.width;
		if (w <= 0) return;
		const { size, pos, height } = this.layout();
		this.height = height;
		const ctx = sizeCanvas(this.canvas, w, height);
		if (!ctx) return;
		ctx.clearRect(0, 0, w, height);
		if (!this.dice.length) {
			ctx.fillStyle = this.colors.muted;
			ctx.font = `500 13px ${this.font}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText("Add dice below", w / 2, height / 2);
			return;
		}
		const t = this.progress;
		this.dice.forEach((d, i) => {
			const p = pos[i];
			const a = this.anim?.get(i);
			let x = p.x;
			let y = p.y;
			let rot = 0;
			let scale = 1;
			let value = d.value;
			if (a) {
				const move = easeOutCubic(Math.min(1, t / 0.85));
				const jit = a.jitter * (1 - move);
				x = a.sx + (p.x - a.sx) * move + randomRange(-jit, jit);
				y = a.sy + (p.y - a.sy) * move + randomRange(-jit, jit) - Math.sin(move * Math.PI) * size * 0.25;
				rot = a.rot0 * (1 - move);
				value = a.shown;
				if (t > 0.85) {
					const k = (t - 0.85) / 0.15;
					scale = 1 + 0.12 * Math.sin(k * Math.PI);
				}
			}
			this.drawDie(ctx, d, value, x, y, size * scale, rot, !a);
		});
	}

	private drawDie(ctx: CanvasRenderingContext2D, d: TrayDie, value: number, x: number, y: number, size: number, rot: number, atRest: boolean): void {
		const color = d.color || this.colors.accent;
		const fg = contrastText(color);
		const s = size / 2;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(rot);
		const dropped = atRest && d.value > 0 && !d.kept;
		if (dropped) ctx.globalAlpha = 0.35;
		const crit = atRest && this.highlight === "crit";
		const fumble = atRest && this.highlight === "fumble";
		if (crit) {
			ctx.shadowColor = this.colors.accent;
			ctx.shadowBlur = 18;
		} else {
			ctx.shadowColor = "rgba(0,0,0,0.3)";
			ctx.shadowBlur = 5;
			ctx.shadowOffsetY = 2;
		}
		const fill = fumble ? mix(color, this.colors.fumble, 0.55) : color;
		const grad = ctx.createLinearGradient(-s, -s, s, s);
		grad.addColorStop(0, shade(fill, 0.22));
		grad.addColorStop(1, shade(fill, -0.2));
		ctx.fillStyle = grad;
		this.shapePath(ctx, d, s);
		ctx.fill();
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetY = 0;
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = shade(fill, -0.35);
		ctx.stroke();
		this.facetLines(ctx, d, s, shade(fill, -0.15));

		// Face
		ctx.fillStyle = fg;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		if (value <= 0) {
			ctx.font = `700 ${Math.round(s * 0.7)}px ${this.font}`;
			ctx.fillText(d.customFaces ? "?" : `d${d.sides}`, 0, 1);
		} else if (d.customFaces) {
			const label = d.customFaces[value - 1] ?? "";
			let fs = Math.round(s * 0.55);
			ctx.font = `700 ${fs}px ${this.font}`;
			while (fs > 8 && ctx.measureText(label).width > s * 1.7) {
				fs--;
				ctx.font = `700 ${fs}px ${this.font}`;
			}
			ctx.fillText(fitText(ctx, label, s * 1.75), 0, 1);
		} else if (d.sides === 6) {
			this.pips(ctx, value, s, fg);
		} else {
			const text = d.sides === 100 ? (value === 100 ? "00" : String(value).padStart(2, "0")) : String(value);
			const yOff = d.sides === 4 ? s * 0.22 : 1;
			let fs = Math.round(s * (text.length > 2 ? 0.55 : d.sides === 4 ? 0.62 : 0.72));
			ctx.font = `800 ${fs}px ${this.font}`;
			while (fs > 8 && ctx.measureText(text).width > s * 1.3) {
				fs--;
				ctx.font = `800 ${fs}px ${this.font}`;
			}
			ctx.fillText(text, 0, yOff);
		}
		ctx.restore();

		if (atRest && dropped) {
			ctx.save();
			ctx.strokeStyle = this.colors.text;
			ctx.globalAlpha = 0.7;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(x - s * 0.9, y);
			ctx.lineTo(x + s * 0.9, y);
			ctx.stroke();
			ctx.restore();
		}
		if (atRest && d.held) {
			ctx.save();
			ctx.strokeStyle = this.colors.accent;
			ctx.lineWidth = 2.5;
			ctx.setLineDash([5, 3]);
			roundRect(ctx, x - s - 5, y - s - 5, size + 10, size + 10, 10);
			ctx.stroke();
			ctx.setLineDash([]);
			this.lockIcon(ctx, x + s + 1, y - s - 1);
			ctx.restore();
		}
	}

	private shapePath(ctx: CanvasRenderingContext2D, d: TrayDie, s: number): void {
		const poly = (n: number, r: number, rotOff = -Math.PI / 2) => {
			ctx.beginPath();
			for (let k = 0; k < n; k++) {
				const a = rotOff + (k * Math.PI * 2) / n;
				const px = Math.cos(a) * r;
				const py = Math.sin(a) * r;
				if (k === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
		};
		if (d.customFaces || d.sides === 6 || d.sides === 100) {
			roundRect(ctx, -s, -s, s * 2, s * 2, s * 0.28);
			return;
		}
		switch (d.sides) {
			case 4:
				poly(3, s * 1.12, -Math.PI / 2);
				break;
			case 8:
				ctx.beginPath();
				ctx.moveTo(0, -s * 1.05);
				ctx.lineTo(s * 0.9, 0);
				ctx.lineTo(0, s * 1.05);
				ctx.lineTo(-s * 0.9, 0);
				ctx.closePath();
				break;
			case 10:
				// kite
				ctx.beginPath();
				ctx.moveTo(0, -s * 1.05);
				ctx.lineTo(s * 0.95, -s * 0.15);
				ctx.lineTo(0, s * 1.0);
				ctx.lineTo(-s * 0.95, -s * 0.15);
				ctx.closePath();
				break;
			case 12:
				poly(5, s * 1.05);
				break;
			case 20:
				poly(6, s * 1.05, -Math.PI / 2);
				break;
			default:
				ctx.beginPath();
				ctx.arc(0, 0, s, 0, Math.PI * 2);
				ctx.closePath();
		}
	}

	/** Subtle facet lines for the polyhedral silhouettes. */
	private facetLines(ctx: CanvasRenderingContext2D, d: TrayDie, s: number, color: string): void {
		if (d.customFaces) return;
		ctx.save();
		ctx.strokeStyle = color;
		ctx.globalAlpha *= 0.6;
		ctx.lineWidth = 1;
		ctx.beginPath();
		if (d.sides === 20) {
			// inner triangle of a d20
			const r = s * 0.62;
			for (let k = 0; k < 3; k++) {
				const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
				const px = Math.cos(a) * r;
				const py = Math.sin(a) * r;
				if (k === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
		} else if (d.sides === 10) {
			ctx.moveTo(-s * 0.95, -s * 0.15);
			ctx.lineTo(0, s * 0.35);
			ctx.lineTo(s * 0.95, -s * 0.15);
		} else if (d.sides === 12) {
			const r = s * 0.55;
			for (let k = 0; k < 5; k++) {
				const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
				const px = Math.cos(a) * r;
				const py = Math.sin(a) * r;
				if (k === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
		} else if (d.sides === 8) {
			ctx.moveTo(-s * 0.9, 0);
			ctx.lineTo(s * 0.9, 0);
		}
		ctx.stroke();
		ctx.restore();
	}

	private pips(ctx: CanvasRenderingContext2D, v: number, s: number, fg: string): void {
		const o = s * 0.5;
		const r = Math.max(2, s * 0.15);
		const spots: Record<number, [number, number][]> = {
			1: [[0, 0]],
			2: [[-o, -o], [o, o]],
			3: [[-o, -o], [0, 0], [o, o]],
			4: [[-o, -o], [o, -o], [-o, o], [o, o]],
			5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
			6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
		};
		ctx.fillStyle = fg;
		for (const [px, py] of spots[v] ?? []) {
			ctx.beginPath();
			ctx.arc(px, py, r, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private lockIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.save();
		ctx.translate(x, y);
		ctx.fillStyle = this.colors.accent;
		ctx.beginPath();
		ctx.arc(0, 0, 10, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = contrastText(this.colors.accent);
		ctx.strokeStyle = contrastText(this.colors.accent);
		ctx.lineWidth = 1.6;
		ctx.fillRect(-4, -1, 8, 6);
		ctx.beginPath();
		ctx.arc(0, -1, 3, Math.PI, 0);
		ctx.stroke();
		ctx.restore();
	}

	/** Center of the stage in client coordinates (confetti origin). */
	get stageHeight(): number {
		return this.height;
	}

	destroy(): void {
		this.cancel();
		this.resizeObs.disconnect();
		this.el.remove();
	}
}

function mix(a: string, b: string, k: number): string {
	const pa = a.replace("#", "");
	const pb = b.replace("#", "");
	if (pa.length !== 6 || pb.length !== 6) return a;
	const c = (i: number) =>
		Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - k) + parseInt(pb.slice(i, i + 2), 16) * k)
			.toString(16)
			.padStart(2, "0");
	return `#${c(0)}${c(2)}${c(4)}`;
}
