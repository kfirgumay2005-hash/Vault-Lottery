// Small DOM helpers shared by the games (all built with createEl, no innerHTML).

import { setIcon, setTooltip } from "obsidian";

const openState = new Map<string, boolean>();

/** A collapsible section (<details>). Its open state is remembered for the session. */
export function collapsible(parent: HTMLElement, title: string, key: string, defaultOpen = false): HTMLElement {
	const details = parent.createEl("details", { cls: "vault-lottery-section" });
	details.open = openState.get(key) ?? defaultOpen;
	const summary = details.createEl("summary", { cls: "vault-lottery-section-title" });
	summary.createSpan({ text: title });
	details.addEventListener("toggle", () => openState.set(key, details.open));
	return details.createDiv({ cls: "vault-lottery-section-body" });
}

export function iconButton(
	parent: HTMLElement,
	icon: string,
	label: string,
	onClick: (e: MouseEvent) => void,
	cls = "",
): HTMLButtonElement {
	const b = parent.createEl("button", { cls: `vault-lottery-icon-btn clickable-icon ${cls}`.trim() });
	setIcon(b, icon);
	b.setAttr("aria-label", label);
	setTooltip(b, label);
	b.addEventListener("click", (e) => {
		e.stopPropagation();
		onClick(e);
	});
	return b;
}

export function textButton(parent: HTMLElement, text: string, onClick: (e: MouseEvent) => void, cls = ""): HTMLButtonElement {
	const b = parent.createEl("button", { text, cls });
	b.addEventListener("click", onClick);
	return b;
}

/** Locks a part of the UI while a game runs (no pointer, no keyboard focus). */
export function setLocked(el: HTMLElement | null | undefined, locked: boolean): void {
	if (!el) return;
	el.toggleClass("vault-lottery-locked", locked);
	if (locked) el.setAttr("inert", "");
	else el.removeAttribute("inert");
}

export function setDisabled(b: HTMLButtonElement | null | undefined, disabled: boolean, reason?: string): void {
	if (!b) return;
	b.disabled = disabled;
	b.toggleClass("is-disabled", disabled);
	if (reason !== undefined) setTooltip(b, disabled ? reason : "");
}

/** Segmented control. Returns a function to set the value programmatically. */
export function segmented<T extends string>(
	parent: HTMLElement,
	options: { value: T; label: string; icon?: string }[],
	value: T,
	onChange: (v: T) => void,
	ariaLabel: string,
): (v: T) => void {
	const wrap = parent.createDiv({ cls: "vault-lottery-segmented", attr: { role: "radiogroup", "aria-label": ariaLabel } });
	const buttons = new Map<T, HTMLButtonElement>();
	const set = (v: T) => {
		for (const [k, b] of buttons) {
			b.toggleClass("is-active", k === v);
			b.setAttr("aria-checked", String(k === v));
		}
	};
	for (const o of options) {
		const b = wrap.createEl("button", { attr: { role: "radio" } });
		if (o.icon) {
			const ic = b.createSpan({ cls: "vault-lottery-seg-icon" });
			setIcon(ic, o.icon);
		}
		b.createSpan({ text: o.label });
		b.addEventListener("click", () => {
			set(o.value);
			onChange(o.value);
		});
		buttons.set(o.value, b);
	}
	set(value);
	return set;
}

export function numberInput(
	parent: HTMLElement,
	value: number,
	min: number,
	max: number,
	onChange: (v: number) => void,
	step = 1,
): HTMLInputElement {
	const input = parent.createEl("input", { type: "number", cls: "vault-lottery-number" });
	input.min = String(min);
	input.max = String(max);
	input.step = String(step);
	input.value = String(value);
	input.inputMode = "numeric";
	input.addEventListener("change", () => {
		let v = parseFloat(input.value);
		if (!Number.isFinite(v)) v = value;
		v = Math.max(min, Math.min(max, v));
		input.value = String(v);
		onChange(v);
	});
	return input;
}

/** Scrolls the nearest scrollable ancestor so `el` is visible (never scrolls sideways or outer drawers). */
export function revealInScroller(el: HTMLElement, margin = 12): void {
	let sc: HTMLElement | null = el.parentElement;
	while (sc && !(sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
	if (!sc) return;
	const r = el.getBoundingClientRect();
	const s = sc.getBoundingClientRect();
	let delta = 0;
	if (r.bottom > s.bottom - margin) delta = Math.min(r.bottom - s.bottom + margin, r.top - s.top - margin);
	else if (r.top < s.top + margin) delta = r.top - s.top - margin;
	if (delta) sc.scrollBy({ top: delta, behavior: "smooth" });
}

export function relativeTime(ts: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - ts) / 1000));
	if (s < 45) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d}d ago`;
	const mo = Math.round(d / 30);
	if (mo < 12) return `${mo}mo ago`;
	return `${Math.round(mo / 12)}y ago`;
}

/** Adds a chip with a × button. */
export function chip(parent: HTMLElement, text: string, onRemove?: () => void, color?: string): HTMLElement {
	const c = parent.createDiv({ cls: "vault-lottery-chip" });
	if (color) c.style.setProperty("--vl-chip-color", color);
	c.createSpan({ text, attr: { dir: "auto" } });
	if (onRemove) {
		const x = c.createEl("button", { cls: "vault-lottery-chip-x", attr: { "aria-label": `Remove ${text}` } });
		setIcon(x, "x");
		x.addEventListener("click", (e) => {
			e.stopPropagation();
			onRemove();
		});
	}
	return c;
}

export function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3);
}

export function easeOutQuart(t: number): number {
	return 1 - Math.pow(1 - t, 4);
}

export function easeOutQuint(t: number): number {
	return 1 - Math.pow(1 - t, 5);
}

export function easeInOutSine(t: number): number {
	return -(Math.cos(Math.PI * t) - 1) / 2;
}

/** Truncates text to fit maxWidth with an ellipsis. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	const chars = Array.from(text);
	let lo = 0;
	let hi = chars.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >>> 1;
		if (ctx.measureText(chars.slice(0, mid).join("") + "…").width <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return lo === 0 ? "…" : chars.slice(0, lo).join("").trimEnd() + "…";
}

/** Sets up a canvas for crisp drawing at devicePixelRatio. Returns the 2D context scaled to CSS px. */
export function sizeCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
	const dpr = window.devicePixelRatio || 1;
	const pw = Math.max(1, Math.round(w * dpr));
	const ph = Math.max(1, Math.round(h * dpr));
	if (canvas.width !== pw) canvas.width = pw;
	if (canvas.height !== ph) canvas.height = ph;
	canvas.style.width = `${w}px`;
	canvas.style.height = `${h}px`;
	const ctx = canvas.getContext("2d");
	ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
	return ctx;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	const rr = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}

/** Long-press (touch) or right-click (mouse) handler. */
export function onLongPress(el: HTMLElement, handler: () => void, ms = 500): { fired: () => boolean } {
	let timer: number | null = null;
	let fired = false;
	let sx = 0;
	let sy = 0;
	const clear = () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
	};
	el.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		clear();
		if (!fired) {
			fired = true;
			handler();
		}
	});
	el.addEventListener("pointerdown", (e: PointerEvent) => {
		fired = false;
		if (e.pointerType === "mouse") return;
		sx = e.clientX;
		sy = e.clientY;
		clear();
		timer = window.setTimeout(() => {
			fired = true;
			timer = null;
			handler();
		}, ms);
	});
	el.addEventListener("pointermove", (e: PointerEvent) => {
		if (timer !== null && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear();
	});
	el.addEventListener("pointerup", clear);
	el.addEventListener("pointercancel", clear);
	el.addEventListener("pointerleave", clear);
	return { fired: () => fired };
}

/** Swallows the click that follows a long press. */
export function consumeLongPressClick(lp: { fired: () => boolean }, e: Event): boolean {
	if (lp.fired()) {
		e.preventDefault();
		e.stopPropagation();
		return true;
	}
	return false;
}
