// Crop tool used for backgrounds, wheel slices and coin faces. Works with mouse and touch (pointer events).

import { App, ButtonComponent, Modal, Notice, Platform, Setting } from "obsidian";
import type { ImageRef } from "../settings";
import { pickFile } from "../shared/modals";
import type { ImageStore } from "./ImageStore";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

export interface CropTarget {
	/** Width / height of the crop. */
	aspect: number;
	/** Offer the "Free aspect" option (view background). */
	allowFree?: boolean;
	/** Circular guide + preview (coin faces). */
	circle?: boolean;
	/** Wheel slice guide + preview: central angle of the wedge in radians (use `wedgeAspect` for `aspect`). */
	wedge?: number;
	/** Max size of the long side of the output. */
	maxSize: number;
	title?: string;
}

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

type DragMode = { kind: "move"; ox: number; oy: number; start: Rect } | { kind: "resize"; corner: number; start: Rect };

const MAX_ZOOM = 6;

/** Width / height of the box around a wheel wedge with this central angle (apex at the bottom, rim on top). */
export function wedgeAspect(angle: number): number {
	const half = Math.min(angle, Math.PI) / 2;
	return 2 * Math.sin(half);
}

/** Path of the crop shape inside `r` (rectangle, ellipse, or wedge with its apex at the bottom center). */
function shapePath(ctx: CanvasRenderingContext2D, r: Rect, target: CropTarget, reverse = false): void {
	if (target.wedge) {
		const half = Math.min(target.wedge, Math.PI) / 2;
		const ax = r.x + r.w / 2;
		const ay = r.y + r.h;
		ctx.moveTo(ax, ay);
		ctx.arc(ax, ay, r.h, -Math.PI / 2 - half, -Math.PI / 2 + half, reverse);
		ctx.closePath();
	} else if (target.circle) {
		ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2, reverse);
	} else if (reverse) {
		ctx.rect(r.x + r.w, r.y, -r.w, r.h);
	} else {
		ctx.rect(r.x, r.y, r.w, r.h);
	}
}

export class CropModal extends Modal {
	private img: HTMLImageElement | null = null;
	private objectUrl: string | null = null;
	private stage!: HTMLDivElement;
	private canvas!: HTMLCanvasElement;
	private preview!: HTMLCanvasElement;
	private zoomSlider: HTMLInputElement | null = null;
	private placeholder!: HTMLDivElement;
	private applyBtn: ButtonComponent | null = null;
	private crop: Rect = { x: 0, y: 0, w: 0, h: 0 };
	private free = false;
	private drag: DragMode | null = null;
	private resizeObs: ResizeObserver | null = null;
	private result: ImageRef | null = null;
	private busy = false;
	// Stage layout (CSS px)
	private sw = 300;
	private sh = 220;
	private scale = 1;
	private offX = 0;
	private offY = 0;

	constructor(
		app: App,
		private store: ImageStore,
		private target: CropTarget,
		private onDone: (ref: ImageRef | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("vault-lottery-crop-modal");
		contentEl.addClass("vault-lottery-modal");
		this.titleEl.setText(this.target.title ?? "Crop image");

		const src = contentEl.createDiv({ cls: "vault-lottery-crop-sources" });
		const vaultBtn = src.createEl("button", { text: "From vault…" });
		vaultBtn.addEventListener("click", () => void this.pickFromVault());
		const deviceBtn = src.createEl("button", { text: Platform.isMobile ? "From device…" : "From computer…" });
		const fileInput = src.createEl("input", { type: "file", cls: "vault-lottery-hidden" });
		fileInput.accept = "image/png,image/jpeg,image/webp,image/gif";
		deviceBtn.addEventListener("click", () => fileInput.click());
		fileInput.addEventListener("change", () => {
			const f = fileInput.files?.[0];
			if (f) this.loadUrl(URL.createObjectURL(f), true);
			fileInput.value = "";
		});

		this.stage = contentEl.createDiv({ cls: "vault-lottery-crop-stage" });
		this.canvas = this.stage.createEl("canvas");
		this.placeholder = this.stage.createDiv({ cls: "vault-lottery-crop-placeholder", text: "Choose an image to crop." });
		this.bindPointer();

		const controls = contentEl.createDiv({ cls: "vault-lottery-crop-controls" });
		const zoomRow = controls.createDiv({ cls: "vault-lottery-crop-zoom" });
		zoomRow.createSpan({ text: "Zoom" });
		this.zoomSlider = zoomRow.createEl("input", { type: "range" });
		this.zoomSlider.min = "1";
		this.zoomSlider.max = String(MAX_ZOOM);
		this.zoomSlider.step = "0.01";
		this.zoomSlider.value = "1";
		this.zoomSlider.addEventListener("input", () => this.setZoom(parseFloat(this.zoomSlider?.value ?? "1")));
		const resetBtn = zoomRow.createEl("button", { text: "Reset" });
		resetBtn.addEventListener("click", () => this.resetCrop());

		const prevWrap = controls.createDiv({ cls: "vault-lottery-crop-preview-wrap" });
		prevWrap.createSpan({ text: "Preview", cls: "vault-lottery-muted" });
		this.preview = prevWrap.createEl("canvas", { cls: "vault-lottery-crop-preview" });
		if (this.target.circle) this.preview.addClass("is-circle");
		if (this.target.wedge) this.preview.addClass("is-wedge");
		if (this.target.allowFree) {
			const free = prevWrap.createEl("label", { cls: "vault-lottery-check-row vault-lottery-crop-free" });
			const cb = free.createEl("input", { type: "checkbox" });
			free.createSpan({ text: "Free aspect" });
			cb.addEventListener("change", () => {
				this.free = cb.checked;
				if (!cb.checked) this.resetCrop();
				this.draw();
			});
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				b.setButtonText("Apply").setCta().onClick(() => void this.apply());
				this.applyBtn = b;
				b.setDisabled(true);
			});

		this.resizeObs = new ResizeObserver(() => this.layout());
		this.resizeObs.observe(this.stage);
		this.layout();
	}

	private async pickFromVault(): Promise<void> {
		const file = await pickFile(this.app, IMAGE_EXTENSIONS, "Choose an image from the vault…");
		if (file) this.loadUrl(this.app.vault.getResourcePath(file), false);
	}

	private loadUrl(url: string, isObjectUrl: boolean): void {
		const img = new Image();
		img.onload = () => {
			if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = isObjectUrl ? url : null;
			this.img = img;
			this.placeholder.hide();
			this.applyBtn?.setDisabled(false);
			this.layout();
			this.resetCrop();
		};
		img.onerror = () => {
			if (isObjectUrl) URL.revokeObjectURL(url);
			new Notice("Could not load that image.");
		};
		img.src = url;
	}

	private aspect(): number | null {
		return this.free ? null : this.target.aspect;
	}

	private maxRect(): Rect {
		const img = this.img;
		if (!img) return { x: 0, y: 0, w: 0, h: 0 };
		const iw = img.naturalWidth;
		const ih = img.naturalHeight;
		const a = this.aspect() ?? iw / ih;
		let w = iw;
		let h = iw / a;
		if (h > ih) {
			h = ih;
			w = ih * a;
		}
		return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
	}

	private resetCrop(): void {
		if (!this.img) return;
		this.crop = this.maxRect();
		if (this.zoomSlider) this.zoomSlider.value = "1";
		this.draw();
	}

	private setZoom(z: number): void {
		if (!this.img) return;
		const m = this.maxRect();
		const cx = this.crop.x + this.crop.w / 2;
		const cy = this.crop.y + this.crop.h / 2;
		const a = this.crop.w / this.crop.h || 1;
		let w = m.w / z;
		let h = w / a;
		if (this.free) {
			// keep the current shape, scale relative to the largest rect of that shape
			const iw = this.img.naturalWidth;
			const ih = this.img.naturalHeight;
			const k = Math.min(iw / this.crop.w, ih / this.crop.h);
			w = (this.crop.w * k) / z;
			h = (this.crop.h * k) / z;
		}
		this.crop = this.clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
		this.draw();
	}

	private syncZoomSlider(): void {
		if (!this.zoomSlider || !this.img) return;
		const m = this.maxRect();
		const z = this.free
			? Math.min(this.img.naturalWidth / this.crop.w, this.img.naturalHeight / this.crop.h)
			: m.w / this.crop.w;
		this.zoomSlider.value = String(Math.max(1, Math.min(MAX_ZOOM, z)));
	}

	private clampRect(r: Rect): Rect {
		const img = this.img;
		if (!img) return r;
		const iw = img.naturalWidth;
		const ih = img.naturalHeight;
		const w = Math.min(r.w, iw);
		const h = Math.min(r.h, ih);
		return { x: Math.max(0, Math.min(iw - w, r.x)), y: Math.max(0, Math.min(ih - h, r.y)), w, h };
	}

	private layout(): void {
		const width = Math.max(200, this.stage.clientWidth || 300);
		const maxH = Math.max(160, Math.min(window.innerHeight * (Platform.isMobile ? 0.42 : 0.45), 420));
		let h = maxH;
		if (this.img) h = Math.min(maxH, (width * this.img.naturalHeight) / this.img.naturalWidth);
		h = Math.max(160, h);
		this.sw = width;
		this.sh = h;
		const dpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.round(width * dpr);
		this.canvas.height = Math.round(h * dpr);
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${h}px`;
		if (this.img) {
			const iw = this.img.naturalWidth;
			const ih = this.img.naturalHeight;
			this.scale = Math.min(width / iw, h / ih);
			this.offX = (width - iw * this.scale) / 2;
			this.offY = (h - ih * this.scale) / 2;
		}
		this.draw();
	}

	private toStage(r: Rect): Rect {
		return { x: this.offX + r.x * this.scale, y: this.offY + r.y * this.scale, w: r.w * this.scale, h: r.h * this.scale };
	}

	private draw(): void {
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, this.sw, this.sh);
		const img = this.img;
		if (!img) return;
		ctx.drawImage(img, this.offX, this.offY, img.naturalWidth * this.scale, img.naturalHeight * this.scale);
		const r = this.toStage(this.crop);
		// Darken outside the crop
		ctx.save();
		ctx.fillStyle = "rgba(0,0,0,0.55)";
		ctx.beginPath();
		ctx.rect(0, 0, this.sw, this.sh);
		shapePath(ctx, r, this.target, true);
		ctx.fill("evenodd");
		ctx.restore();
		// Border, thirds and guide
		ctx.strokeStyle = "rgba(255,255,255,0.95)";
		ctx.lineWidth = 1.5;
		ctx.strokeRect(r.x, r.y, r.w, r.h);
		ctx.strokeStyle = "rgba(255,255,255,0.35)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let i = 1; i < 3; i++) {
			ctx.moveTo(r.x + (r.w * i) / 3, r.y);
			ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
			ctx.moveTo(r.x, r.y + (r.h * i) / 3);
			ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
		}
		ctx.stroke();
		if (this.target.circle || this.target.wedge) {
			ctx.strokeStyle = "rgba(255,255,255,0.9)";
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			shapePath(ctx, r, this.target);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		// Corner handles
		const hs = Platform.isMobile ? 12 : 9;
		ctx.fillStyle = "#ffffff";
		ctx.strokeStyle = "rgba(0,0,0,0.6)";
		for (const [hx, hy] of this.corners(r)) {
			ctx.beginPath();
			ctx.rect(hx - hs / 2, hy - hs / 2, hs, hs);
			ctx.fill();
			ctx.stroke();
		}
		this.drawPreview();
	}

	private corners(r: Rect): [number, number][] {
		return [
			[r.x, r.y],
			[r.x + r.w, r.y],
			[r.x + r.w, r.y + r.h],
			[r.x, r.y + r.h],
		];
	}

	private drawPreview(): void {
		const img = this.img;
		if (!img) return;
		const dpr = window.devicePixelRatio || 1;
		const a = this.crop.w / this.crop.h;
		const max = this.target.wedge ? 110 : 72;
		const pw = a >= 1 ? max : max * a;
		const ph = a >= 1 ? max / a : max;
		this.preview.width = Math.round(pw * dpr);
		this.preview.height = Math.round(ph * dpr);
		this.preview.style.width = `${pw}px`;
		this.preview.style.height = `${ph}px`;
		const ctx = this.preview.getContext("2d");
		if (!ctx) return;
		ctx.imageSmoothingQuality = "high";
		ctx.clearRect(0, 0, this.preview.width, this.preview.height);
		ctx.save();
		if (this.target.wedge) {
			// Show the image the way the slice will: cut to the wedge
			ctx.beginPath();
			shapePath(ctx, { x: 0, y: 0, w: this.preview.width, h: this.preview.height }, this.target);
			ctx.clip();
		}
		ctx.drawImage(img, this.crop.x, this.crop.y, this.crop.w, this.crop.h, 0, 0, this.preview.width, this.preview.height);
		ctx.restore();
	}

	private bindPointer(): void {
		const c = this.canvas;
		const pos = (e: PointerEvent) => {
			const b = c.getBoundingClientRect();
			return { x: e.clientX - b.left, y: e.clientY - b.top };
		};
		c.addEventListener("pointerdown", (e: PointerEvent) => {
			if (!this.img) return;
			const p = pos(e);
			const r = this.toStage(this.crop);
			const hit = Platform.isMobile || e.pointerType === "touch" ? 24 : 14;
			const corner = this.corners(r).findIndex(([hx, hy]) => Math.abs(hx - p.x) <= hit && Math.abs(hy - p.y) <= hit);
			if (corner >= 0) {
				this.drag = { kind: "resize", corner, start: { ...this.crop } };
			} else if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
				this.drag = { kind: "move", ox: p.x, oy: p.y, start: { ...this.crop } };
			} else {
				// Tap outside: center the crop on that point
				const ix = (p.x - this.offX) / this.scale;
				const iy = (p.y - this.offY) / this.scale;
				this.crop = this.clampRect({ ...this.crop, x: ix - this.crop.w / 2, y: iy - this.crop.h / 2 });
				this.drag = { kind: "move", ox: p.x, oy: p.y, start: { ...this.crop } };
				this.draw();
			}
			c.setPointerCapture(e.pointerId);
			e.preventDefault();
		});
		c.addEventListener("pointermove", (e: PointerEvent) => {
			if (!this.img) return;
			const p = pos(e);
			if (!this.drag) {
				const r = this.toStage(this.crop);
				const hit = e.pointerType === "touch" ? 24 : 14;
				const corner = this.corners(r).findIndex(([hx, hy]) => Math.abs(hx - p.x) <= hit && Math.abs(hy - p.y) <= hit);
				c.style.cursor = corner === 0 || corner === 2 ? "nwse-resize" : corner === 1 || corner === 3 ? "nesw-resize" : "move";
				return;
			}
			e.preventDefault();
			if (this.drag.kind === "move") {
				const dx = (p.x - this.drag.ox) / this.scale;
				const dy = (p.y - this.drag.oy) / this.scale;
				this.crop = this.clampRect({ ...this.drag.start, x: this.drag.start.x + dx, y: this.drag.start.y + dy });
			} else {
				this.resizeTo(this.drag.corner, this.drag.start, (p.x - this.offX) / this.scale, (p.y - this.offY) / this.scale);
			}
			this.draw();
		});
		const end = (e: PointerEvent) => {
			if (this.drag) {
				this.drag = null;
				this.syncZoomSlider();
			}
			if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
		};
		c.addEventListener("pointerup", end);
		c.addEventListener("pointercancel", end);
	}

	private resizeTo(corner: number, start: Rect, px: number, py: number): void {
		const img = this.img;
		if (!img) return;
		const iw = img.naturalWidth;
		const ih = img.naturalHeight;
		// Anchor = opposite corner
		const ax = corner === 0 || corner === 3 ? start.x + start.w : start.x;
		const ay = corner === 0 || corner === 1 ? start.y + start.h : start.y;
		const dirX = corner === 0 || corner === 3 ? -1 : 1;
		const dirY = corner === 0 || corner === 1 ? -1 : 1;
		const roomX = dirX < 0 ? ax : iw - ax;
		const roomY = dirY < 0 ? ay : ih - ay;
		const minSize = Math.max(16, Math.min(iw, ih) * 0.04);
		let w = Math.max(0, (px - ax) * dirX);
		let h = Math.max(0, (py - ay) * dirY);
		const a = this.aspect();
		if (a) {
			w = Math.max(w, h * a);
			w = Math.min(w, roomX, roomY * a);
			w = Math.max(w, minSize * Math.max(1, a));
			h = w / a;
		} else {
			w = Math.min(Math.max(w, minSize), roomX);
			h = Math.min(Math.max(h, minSize), roomY);
		}
		const x = dirX < 0 ? ax - w : ax;
		const y = dirY < 0 ? ay - h : ay;
		this.crop = this.clampRect({ x, y, w, h });
	}

	private async apply(): Promise<void> {
		const img = this.img;
		if (!img || this.busy) return;
		this.busy = true;
		try {
			const { w, h } = this.crop;
			const k = Math.min(1, this.target.maxSize / Math.max(w, h));
			const out = createEl("canvas");
			out.width = Math.max(1, Math.round(w * k));
			out.height = Math.max(1, Math.round(h * k));
			const ctx = out.getContext("2d");
			if (!ctx) throw new Error("no canvas");
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(img, this.crop.x, this.crop.y, w, h, 0, 0, out.width, out.height);
			let blob = await toBlob(out, "image/webp", 0.9);
			// Safari (iOS) can't encode WebP and silently returns PNG or null.
			if (!blob || blob.type !== "image/webp") blob = await toBlob(out, "image/png");
			if (!blob) throw new Error("export failed");
			this.result = await this.store.save(blob);
			this.close();
		} catch (e) {
			console.error("Vault Lottery: crop failed", e);
			new Notice("Could not save the cropped image.");
		} finally {
			this.busy = false;
		}
	}

	onClose(): void {
		this.resizeObs?.disconnect();
		this.resizeObs = null;
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = null;
		this.contentEl.empty();
		this.onDone(this.result);
	}
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
	return new Promise((resolve) => {
		try {
			canvas.toBlob((b) => resolve(b), type, quality);
		} catch {
			resolve(null);
		}
	});
}

export function cropImage(app: App, store: ImageStore, target: CropTarget): Promise<ImageRef | null> {
	return new Promise((resolve) => new CropModal(app, store, target, resolve).open());
}
