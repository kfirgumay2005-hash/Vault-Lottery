// In-house confetti: a transparent canvas over the view container only.

import { FESTIVE } from "./color";
import { pick, randomFloat, randomRange } from "./random";

export type Intensity = "low" | "medium" | "high";

export interface ConfettiOptions {
	/** Burst origin in viewport (client) coordinates. */
	x: number;
	y: number;
	colors?: string[];
	intensity: Intensity;
	/** Element that gets a short glow instead, when reduced motion applies. */
	glowEl?: HTMLElement | null;
	ignoreReducedMotion: boolean;
}

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	rot: number;
	vr: number;
	flutter: number;
	vf: number;
	w: number;
	h: number;
	shape: 0 | 1 | 2; // rect, circle, streamer
	color: string;
	life: number;
	maxLife: number;
}

const COUNTS: Record<Intensity, number> = { low: 80, medium: 140, high: 200 };
const DURATION = 2.5;

export function prefersReducedMotion(): boolean {
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

export class Confetti {
	private canvas: HTMLCanvasElement | null = null;
	private particles: Particle[] = [];
	private frame: number | null = null;
	private last = 0;
	private glowTimer: number | null = null;
	private glowEl: HTMLElement | null = null;

	constructor(private host: HTMLElement, private accent: () => string) {}

	fire(o: ConfettiOptions): void {
		this.cancel();
		if (prefersReducedMotion() && !o.ignoreReducedMotion) {
			this.glow(o.glowEl ?? null);
			return;
		}
		const rect = this.host.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return;
		const dpr = window.devicePixelRatio || 1;
		const canvas = this.host.createEl("canvas", { cls: "vault-lottery-confetti" });
		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);
		this.canvas = canvas;

		const ox = o.x - rect.left;
		const oy = o.y - rect.top;
		const palette = [this.accent(), ...(o.colors ?? []), ...FESTIVE];
		const n = COUNTS[o.intensity] ?? COUNTS.medium;
		const scale = Math.max(0.7, Math.min(1.4, rect.width / 320));
		for (let i = 0; i < n; i++) {
			const angle = -Math.PI / 2 + randomRange(-0.65, 0.65);
			const speed = randomRange(260, 680) * scale;
			const shape = randomFloat() < 0.55 ? 0 : randomFloat() < 0.6 ? 1 : 2;
			const size = randomRange(4, 8);
			this.particles.push({
				x: ox + randomRange(-8, 8),
				y: oy + randomRange(-6, 6),
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				rot: randomRange(0, Math.PI * 2),
				vr: randomRange(-8, 8),
				flutter: randomRange(0, Math.PI * 2),
				vf: randomRange(6, 14),
				w: shape === 2 ? size * 0.45 : size,
				h: shape === 2 ? size * 2.6 : shape === 1 ? size : size * 0.6,
				shape,
				color: pick(palette),
				life: 0,
				maxLife: DURATION * randomRange(0.7, 1),
			});
		}
		this.last = performance.now();
		const step = (now: number) => {
			const dt = Math.min(0.05, (now - this.last) / 1000);
			this.last = now;
			if (!this.update(dt)) {
				this.cancel();
				return;
			}
			this.draw(dpr);
			this.frame = window.requestAnimationFrame(step);
		};
		this.frame = window.requestAnimationFrame(step);
	}

	private update(dt: number): boolean {
		const gravity = 900;
		const drag = 2.2;
		let alive = 0;
		for (const p of this.particles) {
			p.life += dt;
			if (p.life >= p.maxLife) continue;
			alive++;
			p.vx -= p.vx * drag * dt;
			p.vy -= p.vy * drag * dt;
			p.vy += gravity * dt * (p.shape === 2 ? 0.55 : 0.75);
			p.x += p.vx * dt + Math.sin(p.flutter) * 12 * dt;
			p.y += p.vy * dt;
			p.rot += p.vr * dt;
			p.flutter += p.vf * dt;
		}
		return alive > 0;
	}

	private draw(dpr: number): void {
		const c = this.canvas;
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, c.width, c.height);
		ctx.scale(dpr, dpr);
		for (const p of this.particles) {
			if (p.life >= p.maxLife) continue;
			const k = p.life / p.maxLife;
			ctx.globalAlpha = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
			ctx.fillStyle = p.color;
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(p.rot);
			ctx.scale(Math.cos(p.flutter), 1); // fake 3D flip
			if (p.shape === 1) {
				ctx.beginPath();
				ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
				ctx.fill();
			} else {
				ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
			}
			ctx.restore();
		}
		ctx.globalAlpha = 1;
	}

	private glow(el: HTMLElement | null): void {
		if (!el) return;
		this.glowEl = el;
		el.addClass("vault-lottery-glow");
		this.glowTimer = window.setTimeout(() => {
			el.removeClass("vault-lottery-glow");
			this.glowTimer = null;
			this.glowEl = null;
		}, 1200);
	}

	cancel(): void {
		if (this.frame !== null) window.cancelAnimationFrame(this.frame);
		this.frame = null;
		this.particles = [];
		this.canvas?.remove();
		this.canvas = null;
		if (this.glowTimer !== null) window.clearTimeout(this.glowTimer);
		this.glowTimer = null;
		this.glowEl?.removeClass("vault-lottery-glow");
		this.glowEl = null;
	}
}
