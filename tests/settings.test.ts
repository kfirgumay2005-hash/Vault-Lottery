import { describe, expect, it } from "vitest";
import { defaultData, mergeDeep, normalizeData, replacePathDeep } from "../src/settings";
import { textDirection } from "../src/shared/bidi";

describe("replacePathDeep", () => {
	it("rewrites a renamed file wherever it appears", () => {
		const d = { a: { path: "Images/x.png" }, list: ["Images/x.png", "Images/y.png"], n: 3 };
		expect(replacePathDeep(d, "Images/x.png", "Media/x.png")).toBe(true);
		expect(d).toEqual({ a: { path: "Media/x.png" }, list: ["Media/x.png", "Images/y.png"], n: 3 });
	});
	it("rewrites everything inside a renamed folder, but not look-alike names", () => {
		const d = { a: "Images/x.png", b: "Images2/x.png", c: ["Images/sub/z.mp4"] };
		replacePathDeep(d, "Images", "Media", true);
		expect(d).toEqual({ a: "Media/x.png", b: "Images2/x.png", c: ["Media/sub/z.mp4"] });
	});
	it("reports when nothing changed", () => {
		expect(replacePathDeep({ a: "x" }, "y", "z")).toBe(false);
	});
});

describe("slice text size", () => {
	const load = (slices: unknown[]) =>
		normalizeData(mergeDeep(defaultData(), { wheel: { workingSlices: slices } })).wheel.workingSlices;

	it("defaults to automatic (1) for older slices", () => {
		expect(load([{ label: "A" }, { label: "B" }]).map((s) => s.textScale)).toEqual([1, 1]);
	});

	it("is clamped to 0.5 … 1.5", () => {
		expect(load([{ textScale: 0.1 }, { textScale: 9 }, { textScale: "x" }]).map((s) => s.textScale)).toEqual([0.5, 1.5, 1]);
	});
});

describe("canvas text direction", () => {
	it("follows the first letter, like dir=auto", () => {
		expect(textDirection("20 כפיפות בטן אופניים")).toBe("rtl");
		expect(textDirection("כפיפות 10")).toBe("rtl");
		expect(textDirection("20 push-ups")).toBe("ltr");
		expect(textDirection("Hello שלום")).toBe("ltr");
		expect(textDirection("123")).toBe("ltr");
		expect(textDirection("مرحبا 5")).toBe("rtl");
	});
});
