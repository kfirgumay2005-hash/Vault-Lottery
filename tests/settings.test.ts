import { describe, expect, it } from "vitest";
import { replacePathDeep } from "../src/settings";

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
