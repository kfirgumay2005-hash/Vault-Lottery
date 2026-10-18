// Paints a game background (color, image or looping video, with opacity and blur) onto a layer element.

import type { App } from "obsidian";
import type { ImageStore } from "../images/ImageStore";
import type { Background } from "../settings";
import { vaultUrl } from "./media";

export function paintBackground(el: HTMLElement, bg: Background | null, images: ImageStore, app: App): void {
	let video = el.querySelector<HTMLVideoElement>("video.vault-lottery-bg-video");
	const videoUrl = bg?.type === "video" && bg.videoPath ? vaultUrl(app, bg.videoPath) : null;
	if (!videoUrl && video) {
		video.pause();
		video.removeAttribute("src");
		video.load();
		video.remove();
		video = null;
	}
	el.removeClass("is-color", "is-image", "is-video");
	el.style.removeProperty("background-image");
	el.style.removeProperty("background-color");
	el.style.removeProperty("filter");
	el.style.removeProperty("opacity");
	if (!bg) return;
	if (bg.type === "color") {
		el.addClass("is-color");
		el.style.backgroundColor = bg.color;
		el.style.opacity = String(bg.opacity);
	} else if (bg.type === "image" && bg.image) {
		el.addClass("is-image");
		const url = images.url(bg.image);
		el.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
		el.style.opacity = String(bg.opacity);
		el.style.filter = bg.blur > 0 ? `blur(${bg.blur}px)` : "";
	} else if (bg.type === "video" && videoUrl) {
		el.addClass("is-video");
		if (!video) {
			video = el.createEl("video", { cls: "vault-lottery-bg-video" });
			// Muted + inline so it may autoplay on phones too
			video.muted = true;
			video.loop = true;
			video.autoplay = true;
			video.playsInline = true;
			video.setAttr("playsinline", "");
			video.setAttr("aria-hidden", "true");
		}
		if (video.getAttr("src") !== videoUrl) video.src = videoUrl;
		void video.play().catch(() => undefined);
		el.style.opacity = String(bg.opacity);
		el.style.filter = bg.blur > 0 ? `blur(${bg.blur}px)` : "";
	}
}
