// Text direction for canvas labels (canvas text has no `dir="auto"`).

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

/** "rtl" when the first letter is Hebrew / Arabic (like `dir="auto"` in an input), otherwise "ltr". */
export function textDirection(text: string): "rtl" | "ltr" {
	const first = /\p{L}/u.exec(text);
	return first && RTL_CHAR.test(first[0]) ? "rtl" : "ltr";
}

/**
 * Without this, "20 כפיפות" is laid out left-to-right and the number ends up after the Hebrew.
 * Call before measuring and drawing user text.
 */
export function setTextDirection(ctx: CanvasRenderingContext2D, text: string): void {
	ctx.direction = textDirection(text);
}
