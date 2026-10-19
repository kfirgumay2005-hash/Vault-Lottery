// Setting builders shared by the settings tab and the in-view "Sound & appearance" sections.

import { Notice, Platform, Setting, setIcon } from "obsidian";
import type VaultLotteryPlugin from "../main";
import { cropImage } from "../images/CropModal";
import { TICK_SOUND_NAMES, type GameId, type TickOverride, type TickSoundId } from "../settings";
import { AUDIO_EXTENSIONS, type SlotName } from "./AudioManager";
import { saveAttachment } from "./media";
import { pickDeviceFile, pickFile } from "./modals";
import { collapsible } from "./ui";

const SLOT_INFO: Record<SlotName, { name: string; desc: string }> = {
	menuMusic: { name: "Menu music", desc: "Loops while the view is open and visible." },
	spinMusic: { name: "Spin music", desc: "Loops while a wheel spin, note draw or team deal runs." },
	endSound: { name: "End sound", desc: "Plays once when a spin, draw or deal stops." },
};

const VIDEO_EXTENSIONS = ["mp4", "m4v", "webm"];
const DEVICE_LABEL = Platform.isMobile ? "From device…" : "From computer…";

function fileName(path: string | null): string {
	if (!path) return "No file";
	return path.split("/").pop() ?? path;
}

/** Copies a file from the computer / device into the vault's attachment folder. Returns its vault path. */
async function addDeviceFile(plugin: VaultLotteryPlugin, accept: string): Promise<string | null> {
	const f = await pickDeviceFile(accept);
	if (!f) return null;
	const notice = f.size > 5_000_000 ? new Notice("Copying the file…", 0) : null;
	try {
		const file = await saveAttachment(plugin.app, await f.arrayBuffer(), f.name);
		plugin.trackOwned(file.path);
		new Notice(`Saved to ${file.path}`);
		return file.path;
	} catch (e) {
		console.error("Vault Lottery: could not save file", e);
		new Notice("Could not save the file.");
		return null;
	} finally {
		notice?.hide();
	}
}

export function buildAudioSlot(el: HTMLElement, plugin: VaultLotteryPlugin, name: SlotName, onRedraw: () => void): void {
	const slot = plugin.data.audio[name];
	const info = SLOT_INFO[name];
	const s = new Setting(el).setName(info.name).setDesc(info.desc);
	s.settingEl.addClass("vault-lottery-audio-setting");
	s.addToggle((t) =>
		t.setValue(slot.enabled).setTooltip(slot.enabled ? "On" : "Off").onChange((v) => {
			slot.enabled = v;
			plugin.saveSoon();
			plugin.audio.refresh();
		}),
	);
	s.setDesc(`${info.desc} File: ${slot.path ? fileName(slot.path) : "none"}.`);
	const use = (path: string) => {
		slot.path = path;
		slot.enabled = true;
		plugin.saveSoon();
		plugin.scheduleMediaGc();
		plugin.audio.refresh();
		onRedraw();
	};
	const s2 = new Setting(el).setClass("vault-lottery-subsetting");
	s2.addButton((b) =>
		b.setButtonText("From vault…").setTooltip(slot.path ?? "Choose a sound file in the vault").onClick(async () => {
			const f = await pickFile(plugin.app, AUDIO_EXTENSIONS, "Choose an audio file (mp3, wav, ogg, m4a, flac)…");
			if (f) use(f.path);
		}),
	);
	s2.addButton((b) =>
		b.setButtonText(DEVICE_LABEL).setTooltip("Saved to your attachment folder").onClick(async () => {
			const path = await addDeviceFile(plugin, "audio/*,.mp3,.wav,.ogg,.m4a,.flac");
			if (path) use(path);
		}),
	);
	s2.addSlider((sl) =>
		sl.setLimits(0, 100, 1).setValue(Math.round(slot.volume * 100)).onChange((v) => {
			slot.volume = v / 100;
			plugin.saveSoon();
			plugin.audio.refresh();
		}),
	);
	s2.addExtraButton((b) => {
		b.setIcon("play").setTooltip("Preview").onClick(() => {
			const playing = plugin.audio.previewSlot(name, () => {
				b.setIcon("play");
			});
			b.setIcon(playing ? "square" : "play");
		});
	});
	if (slot.path) {
		s2.addExtraButton((b) =>
			b.setIcon("x").setTooltip("Clear").onClick(() => {
				slot.path = null;
				slot.enabled = false;
				plugin.scheduleMediaGc();
				plugin.saveSoon();
				plugin.audio.refresh();
				onRedraw();
			}),
		);
	}
}

export function buildTickSound(el: HTMLElement, plugin: VaultLotteryPlugin): void {
	const t = plugin.data.audio.tickSound;
	new Setting(el)
		.setName("Tick sound")
		.setDesc("Built-in mechanical tick, played each time a slice, row or name passes.")
		.addToggle((tg) => tg.setValue(t.enabled).onChange((v) => {
			t.enabled = v;
			plugin.saveSoon();
		}));
	new Setting(el)
		.setClass("vault-lottery-subsetting")
		.addDropdown((d) => {
			for (const id of [1, 2, 3, 4, 5] as TickSoundId[]) d.addOption(String(id), TICK_SOUND_NAMES[id]);
			d.setValue(String(t.soundId)).onChange((v) => {
				t.soundId = parseInt(v) as TickSoundId;
				plugin.saveSoon();
				plugin.audio.previewTicks(t.soundId);
			});
		})
		.addSlider((sl) => sl.setLimits(0, 100, 1).setValue(Math.round(t.volume * 100)).onChange((v) => {
			t.volume = v / 100;
			plugin.saveSoon();
		}))
		.addExtraButton((b) => b.setIcon("play").setTooltip("Preview").onClick(() => plugin.audio.previewTicks(t.soundId)));
}

export function buildTickOverride(
	el: HTMLElement,
	plugin: VaultLotteryPlugin,
	get: () => TickOverride,
	set: (v: TickOverride) => void,
): void {
	new Setting(el)
		.setName("Tick sound for this game")
		.addDropdown((d) => {
			d.addOption("0", "Use global");
			for (const id of [1, 2, 3, 4, 5] as TickSoundId[]) d.addOption(String(id), TICK_SOUND_NAMES[id]);
			d.setValue(String(get())).onChange((v) => {
				const n = parseInt(v) as TickOverride;
				set(n);
				plugin.saveSoon();
				const id = plugin.audio.resolveTick(n);
				if (id) plugin.audio.previewTicks(id);
			});
		})
		.addExtraButton((b) => b.setIcon("play").setTooltip("Preview").onClick(() => {
			const id = plugin.audio.resolveTick(get()) ?? plugin.data.audio.tickSound.soundId;
			plugin.audio.previewTicks(id);
		}));
}

/** Background settings of one game (each game has its own background). */
export function buildBackground(el: HTMLElement, plugin: VaultLotteryPlugin, game: GameId, onRedraw: () => void): void {
	const bg = plugin.data[game].background;
	const changed = () => {
		plugin.saveSoon();
		plugin.applyBackground();
	};
	new Setting(el)
		.setName("Background")
		.setDesc("Only for this game.")
		.addDropdown((d) =>
			d.addOptions({ none: "None (theme)", color: "Solid color", image: "Image", video: "Video (mp4)" }).setValue(bg.type).onChange(async (v) => {
				if (v === "image" && !bg.image) {
					const ok = await chooseBackgroundImage(plugin, game);
					if (!ok) {
						onRedraw();
						return;
					}
				}
				bg.type = v as typeof bg.type;
				changed();
				onRedraw();
			}),
		);
	if (bg.type !== "none" && game === "wheel") {
		new Setting(el)
			.setClass("vault-lottery-subsetting")
			.setName("Show on")
			.addDropdown((d) =>
				d.addOptions({ view: "Whole view", wheel: "Wheel area only (behind the wheel)" }).setValue(bg.scope).onChange((v) => {
					bg.scope = v as typeof bg.scope;
					changed();
				}),
			);
	}
	if (bg.type === "color") {
		new Setting(el).setClass("vault-lottery-subsetting").setName("Color").addColorPicker((c) =>
			c.setValue(bg.color).onChange((v) => {
				bg.color = v;
				changed();
			}),
		);
	}
	if (bg.type === "image") {
		new Setting(el)
			.setClass("vault-lottery-subsetting")
			.setName("Image")
			.addButton((b) => b.setButtonText(bg.image ? "Change image…" : "Choose image…").onClick(async () => {
				if (await chooseBackgroundImage(plugin, game)) onRedraw();
			}))
			.addExtraButton((b) => b.setIcon("trash-2").setTooltip("Remove image").onClick(() => {
				const old = bg.image;
				bg.image = undefined;
				bg.type = "none";
				changed();
				plugin.releaseImage(old);
				onRedraw();
			}));
	}
	if (bg.type !== "none") {
		new Setting(el).setClass("vault-lottery-subsetting").setName("Opacity").addSlider((s) =>
			s.setLimits(0, 100, 1).setValue(Math.round(bg.opacity * 100)).onChange((v) => {
				bg.opacity = v / 100;
				changed();
			}),
		);
	}
	if (bg.type === "video") {
		const useVideo = (path: string | null) => {
			if (!path) return;
			bg.videoPath = path;
			changed();
			plugin.scheduleMediaGc();
			onRedraw();
		};
		new Setting(el)
			.setClass("vault-lottery-subsetting")
			.setName("Video")
			.setDesc(bg.videoPath ? `${fileName(bg.videoPath)} (loops, muted)` : "Choose an mp4. It loops, muted. Files from the computer go to your attachment folder.")
			.addButton((b) => b.setButtonText("From vault…").onClick(async () => {
				const f = await pickFile(plugin.app, VIDEO_EXTENSIONS, "Choose a video (mp4, webm)…");
				useVideo(f?.path ?? null);
			}))
			.addButton((b) => b.setButtonText(DEVICE_LABEL).onClick(async () => {
				useVideo(await addDeviceFile(plugin, "video/mp4,video/webm,.mp4,.m4v,.webm"));
			}))
			.addExtraButton((b) => b.setIcon("trash-2").setTooltip("Remove video").onClick(() => {
				bg.videoPath = undefined;
				bg.type = "none";
				changed();
				plugin.scheduleMediaGc();
				onRedraw();
			}));
	}
	if (bg.type === "image" || bg.type === "video") {
		new Setting(el).setClass("vault-lottery-subsetting").setName("Blur").addSlider((s) =>
			s.setLimits(0, 20, 1).setValue(bg.blur).onChange((v) => {
				bg.blur = v;
				changed();
			}),
		);
	}
}

async function chooseBackgroundImage(plugin: VaultLotteryPlugin, game: GameId): Promise<boolean> {
	const bg = plugin.data[game].background;
	const onWheel = game === "wheel" && bg.scope === "wheel";
	const ref = await cropImage(plugin.app, plugin.images, {
		aspect: onWheel ? plugin.viewAspect(".vault-lottery-wheel-wrap") : plugin.viewAspect(),
		allowFree: true,
		maxSize: 1600,
		title: onWheel ? "Crop wheel background" : "Crop background",
	});
	if (!ref) return false;
	const old = bg.image;
	bg.image = ref;
	bg.type = "image";
	plugin.saveSoon();
	plugin.releaseImage(old);
	plugin.applyBackground();
	return true;
}

/**
 * The collapsible "Sound & appearance" section at the bottom of a game.
 * `extra` adds game-specific rows at the top (tick override, confetti toggle…).
 */
export function soundAppearanceSection(
	parent: HTMLElement,
	plugin: VaultLotteryPlugin,
	key: GameId,
	extra?: (el: HTMLElement) => void,
	opts: { musicSlots?: boolean; tick?: boolean } = { musicSlots: true, tick: true },
): HTMLElement {
	const body = collapsible(parent, "Sound & appearance", `appearance-${key}`);
	body.addClass("vault-lottery-appearance");
	const render = () => {
		body.empty();
		extra?.(body);
		if (opts.tick !== false) buildTickSound(body, plugin);
		if (opts.musicSlots !== false) {
			for (const s of ["menuMusic", "spinMusic", "endSound"] as SlotName[]) buildAudioSlot(body, plugin, s, render);
		} else {
			buildAudioSlot(body, plugin, "menuMusic", render);
		}
		buildBackground(body, plugin, key, render);
		const more = body.createDiv({ cls: "vault-lottery-more-settings" });
		const link = more.createEl("button", { cls: "mod-muted" });
		setIcon(link.createSpan(), "settings");
		link.createSpan({ text: " All settings" });
		link.addEventListener("click", () => plugin.openSettings());
	};
	render();
	return body;
}
