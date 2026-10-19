// Processed (cropped) images are vault files in the folder Obsidian uses for new attachments.
// Older versions kept them in the plugin folder (<plugin dir>/images/<uuid>.webp|png); those "legacy" files are
// looked up in this device's plugin folder and moved to the attachment folder on load (see main.ts).

import { App, normalizePath } from "obsidian";
import type { ImageRef } from "../settings";
import { saveAttachment, vaultUrl } from "../shared/media";
import { uuid } from "../shared/random";

const LEGACY = /^\.[^/]+\/plugins\/[^/]+\/images\/[^/]+$/;

export class ImageStore {
	private cache = new Map<string, Promise<HTMLImageElement | null>>();

	constructor(
		private app: App,
		private pluginDir: string,
		/** Called with the vault path of every file this store creates. */
		private onCreated: (path: string) => void,
	) {}

	/** The old in-plugin image folder. */
	get dir(): string {
		return normalizePath(`${this.pluginDir}/images`);
	}

	async save(blob: Blob): Promise<ImageRef> {
		const id = uuid();
		const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
		const file = await saveAttachment(this.app, await blob.arrayBuffer(), `Vault Lottery ${id.slice(0, 8)}.${ext}`);
		this.onCreated(file.path);
		return { id, path: file.path };
	}

	/** Image saved by an older version inside the plugin folder? */
	isLegacy(ref: ImageRef): boolean {
		return LEGACY.test(ref.path);
	}

	/** Where the image's file is on this device. */
	path(ref: ImageRef): string {
		if (!this.isLegacy(ref)) return ref.path;
		const name = ref.path.split("/").pop() || `${ref.id}.webp`;
		return normalizePath(`${this.dir}/${name}`);
	}

	url(ref: ImageRef): string {
		return this.isLegacy(ref) ? this.app.vault.adapter.getResourcePath(this.path(ref)) : vaultUrl(this.app, ref.path);
	}

	/** Loaded image for drawing on canvas (cached). Resolves null if the file is missing. */
	load(ref: ImageRef): Promise<HTMLImageElement | null> {
		let p = this.cache.get(ref.path);
		if (!p) {
			p = new Promise((resolve) => {
				const img = new Image();
				img.decoding = "async";
				img.onload = () => resolve(img);
				img.onerror = () => resolve(null);
				img.src = this.url(ref);
			});
			this.cache.set(ref.path, p);
			void p.then((img) => {
				if (!img) this.cache.delete(ref.path);
			});
		}
		return p;
	}

	/** Synchronous access if already loaded (for redraws during animation). */
	private loaded = new Map<string, HTMLImageElement>();

	get(ref: ImageRef | undefined, onReady?: () => void): HTMLImageElement | null {
		if (!ref) return null;
		const img = this.loaded.get(ref.path);
		if (img) return img;
		void this.load(ref).then((im) => {
			if (im) {
				const first = !this.loaded.has(ref.path);
				this.loaded.set(ref.path, im);
				if (first) onReady?.();
			}
		});
		return null;
	}

	/** Forgets a cached image (its file was deleted or replaced). */
	forget(path: string): void {
		this.cache.delete(path);
		this.loaded.delete(path);
	}

	/** Deletes files in the old in-plugin folder whose name no longer appears in `json`. */
	async collectLegacyGarbage(json: string): Promise<void> {
		try {
			if (!(await this.app.vault.adapter.exists(this.dir))) return;
			const list = await this.app.vault.adapter.list(this.dir);
			for (const file of list.files) {
				const name = file.split("/").pop() ?? "";
				if (name && !json.includes(name)) await this.app.vault.adapter.remove(file);
			}
		} catch {
			/* ignore */
		}
	}
}
