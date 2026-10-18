// Small color helpers shared by the games.

export const PALETTE = [
	"#e6194b", "#f58231", "#ffe119", "#3cb44b", "#42d4f4", "#4363d8",
	"#911eb4", "#f032e6", "#fabed4", "#469990", "#9a6324", "#800000",
	"#aaffc3", "#808000", "#ffd8b1", "#000075", "#bfef45", "#dcbeff",
];

/** A softer palette used for new wheel slices (pleasant, distinct). */
export const SLICE_PALETTE = [
	"#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#8e7dbe", "#f78c6b",
	"#83c5be", "#e5989b", "#90be6d", "#f9844a", "#577590", "#c77dff",
];

export const FESTIVE = ["#ff4d6d", "#ffd60a", "#3a86ff", "#06d6a0", "#ff9f1c", "#c77dff", "#ffffff"];

export const TEAM_COLOR_NAMES: [string, string][] = [
	["Red", "#e63946"], ["Blue", "#3a86ff"], ["Green", "#2a9d8f"], ["Yellow", "#f4c430"],
	["Purple", "#8e44ad"], ["Orange", "#f77f00"], ["Pink", "#ff70a6"], ["Teal", "#00a6a6"],
	["Brown", "#8d5524"], ["Gray", "#6c757d"], ["Lime", "#80b918"], ["Navy", "#1d3557"],
	["Maroon", "#800f2f"], ["Olive", "#6b705c"], ["Cyan", "#00b4d8"], ["Magenta", "#d63384"],
	["Gold", "#d4a017"], ["Silver", "#a8a9ad"], ["Black", "#222222"], ["White", "#f1f1f1"],
];

export function parseHex(hex: string): [number, number, number] | null {
	let h = hex.trim().replace(/^#/, "");
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	if (!/^[0-9a-f]{6}$/i.test(h)) return null;
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex(r: number, g: number, b: number): string {
	const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
	return `#${c(r)}${c(g)}${c(b)}`;
}

/** Relative luminance (WCAG). */
export function luminance(hex: string): number {
	const rgb = parseHex(hex);
	if (!rgb) return 0.5;
	const [r, g, b] = rgb.map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads better on the given fill. */
export function contrastText(fill: string): string {
	return luminance(fill) > 0.42 ? "#111111" : "#ffffff";
}

export function shade(hex: string, amount: number): string {
	const rgb = parseHex(hex);
	if (!rgb) return hex;
	const [r, g, b] = rgb;
	if (amount >= 0) return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
	return toHex(r * (1 + amount), g * (1 + amount), b * (1 + amount));
}

/** Converts any CSS color string the browser understands to #rrggbb (via a 1px canvas). */
export function cssToHex(color: string, fallback = "#7c3aed"): string {
	if (!color) return fallback;
	const c = color.trim();
	if (parseHex(c)) return c.startsWith("#") ? c : `#${c}`;
	try {
		const cv = document.createElement("canvas");
		cv.width = cv.height = 1;
		const ctx = cv.getContext("2d");
		if (!ctx) return fallback;
		ctx.fillStyle = "#000";
		ctx.fillStyle = c;
		const v = ctx.fillStyle as string;
		if (v.startsWith("#")) return v;
		const m = v.match(/rgba?\(([^)]+)\)/);
		if (m) {
			const [r, g, b] = m[1].split(",").map((s) => parseFloat(s));
			return toHex(r, g, b);
		}
	} catch {
		/* ignore */
	}
	return fallback;
}

/** Reads a theme CSS variable from an element as #rrggbb. */
export function themeColor(el: HTMLElement, name: string, fallback: string): string {
	if (!getComputedStyle(el).getPropertyValue(name).trim()) return fallback;
	// Let the browser resolve var()/calc()/hsl() by computing a real `color` property.
	const probe = el.ownerDocument.createElement("span");
	probe.style.display = "none";
	probe.style.color = `var(${name})`;
	el.appendChild(probe);
	const v = getComputedStyle(probe).color;
	probe.remove();
	return v ? cssToHex(v, fallback) : fallback;
}

/** The interface font family for canvas text (canvas can't resolve CSS variables). */
export function themeFont(el: HTMLElement): string {
	const f = getComputedStyle(el).fontFamily;
	return f && f.trim() ? f : "sans-serif";
}
