// One audio system for all games: three user-file slots (<audio>), synthesized ticks and dice/coin sounds.

import { App, Notice, TFile } from "obsidian";
import type { AudioSlot, PluginData, TickOverride, TickSoundId } from "../settings";
import { playCoinFlip, playCoinLand, playDiceLand, playDiceRattle, playTick } from "./builtinSounds";

export type SlotName = "menuMusic" | "spinMusic" | "endSound";

export const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "flac"];

const TICK_THROTTLE_MS = 25;

export class AudioManager {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private els: Partial<Record<SlotName, HTMLAudioElement>> = {};
	private elPaths: Partial<Record<SlotName, string>> = {};
	/** A result's own end sound (a wheel slice's sound), played instead of the end sound slot. */
	private resultEl: { path: string; el: HTMLAudioElement } | null = null;
	private warnedMissing = new Set<string>();
	private lastTick = 0;

	/** True while the view is open and visible (menu music may play). */
	private menuActive = false;
	/** Menu music was paused because a game started with spin music. */
	private menuPausedForGame = false;
	private gameRunning = false;
	private menuBlocked = false;
	private fadeTimer: number | null = null;
	private endTimer: number | null = null;
	private previewing: { key: string; el: HTMLAudioElement } | null = null;
	private previewTickTimer: number | null = null;

	constructor(private app: App, private data: () => PluginData) {}

	// ---------- Web Audio ----------

	private audioCtx(): AudioContext | null {
		if (!this.ctx) {
			const Ctor: typeof AudioContext | undefined =
				window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!Ctor) return null;
			try {
				this.ctx = new Ctor();
				this.master = this.ctx.createGain();
				this.master.connect(this.ctx.destination);
			} catch {
				return null;
			}
		}
		if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
		return this.ctx;
	}

	/** Call from a user gesture (mobile browsers only allow audio to start there). */
	unlock(): void {
		this.audioCtx();
		if (this.menuBlocked && this.menuActive) {
			this.menuBlocked = false;
			this.updateMenu();
		}
	}

	private out(volume: number): { ctx: AudioContext; node: GainNode } | null {
		const ctx = this.audioCtx();
		if (!ctx || !this.master) return null;
		const g = ctx.createGain();
		g.gain.value = Math.max(0, Math.min(1, volume));
		g.connect(this.master);
		// Disconnect after sounds finish so nodes can be garbage collected.
		window.setTimeout(() => g.disconnect(), 2500);
		return { ctx, node: g };
	}

	resolveTick(override: TickOverride): TickSoundId | null {
		const t = this.data().audio.tickSound;
		if (!t.enabled) return null;
		return override === 0 ? t.soundId : override;
	}

	/** A tick of the chosen sound, throttled to ~25 ms. */
	tick(override: TickOverride = 0): void {
		const id = this.resolveTick(override);
		if (id === null) return;
		const now = performance.now();
		if (now - this.lastTick < TICK_THROTTLE_MS) return;
		this.lastTick = now;
		const o = this.out(this.data().audio.tickSound.volume);
		if (o) playTick(o.ctx, o.node, id, o.ctx.currentTime);
	}

	/** About one second of ticks at a demo speed (slowing down). */
	previewTicks(id: TickSoundId, volume?: number): void {
		this.stopTickPreview();
		const o = this.out(volume ?? this.data().audio.tickSound.volume);
		if (!o) return;
		let t = o.ctx.currentTime + 0.02;
		let gap = 0.045;
		while (t < o.ctx.currentTime + 1.1) {
			playTick(o.ctx, o.node, id, t);
			t += gap;
			gap *= 1.12;
		}
	}

	private stopTickPreview(): void {
		if (this.previewTickTimer !== null) window.clearTimeout(this.previewTickTimer);
		this.previewTickTimer = null;
	}

	private diceOut(): { ctx: AudioContext; node: GainNode } | null {
		const d = this.data().dice;
		if (!d.soundsEnabled) return null;
		return this.out(d.soundsVolume);
	}

	diceRattle(count: number, force = false): void {
		const o = force ? this.out(this.data().dice.soundsVolume) : this.diceOut();
		if (o) playDiceRattle(o.ctx, o.node, o.ctx.currentTime, count);
	}

	diceLand(count: number, force = false): void {
		const o = force ? this.out(this.data().dice.soundsVolume) : this.diceOut();
		if (o) playDiceLand(o.ctx, o.node, o.ctx.currentTime, count);
	}

	coinFlip(force = false): void {
		const o = force ? this.out(this.data().dice.soundsVolume) : this.diceOut();
		if (o) playCoinFlip(o.ctx, o.node, o.ctx.currentTime);
	}

	coinLand(force = false): void {
		const o = force ? this.out(this.data().dice.soundsVolume) : this.diceOut();
		if (o) playCoinLand(o.ctx, o.node, o.ctx.currentTime);
	}

	// ---------- User file slots ----------

	private slot(name: SlotName): AudioSlot {
		return this.data().audio[name];
	}

	/** The slot's sound file in the vault. */
	private sourceFor(name: SlotName): { key: string; url: string } | null {
		const s = this.slot(name);
		return s.path ? this.sourceForPath(s.path) : null;
	}

	private sourceForPath(path: string): { key: string; url: string } | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) return { key: f.path, url: this.app.vault.getResourcePath(f) };
		if (!this.warnedMissing.has(path)) {
			this.warnedMissing.add(path);
			new Notice(`Vault Lottery: audio file not found: ${path}`);
		}
		return null;
	}

	/** The <audio> element for a result's own end sound, at the end sound's volume. */
	private resultElement(path: string): HTMLAudioElement | null {
		const src = this.sourceForPath(path);
		if (!src) return null;
		if (this.resultEl?.path !== src.key) {
			this.resultEl?.el.pause();
			const el = new Audio(src.url);
			el.preload = "auto";
			this.resultEl = { path: src.key, el };
		}
		const el = this.resultEl.el;
		el.volume = Math.max(0, Math.min(1, this.slot("endSound").volume));
		return el;
	}

	/** The <audio> element of a slot, or null if the slot is off/empty/missing. */
	private element(name: SlotName, requireEnabled = true): HTMLAudioElement | null {
		const s = this.slot(name);
		if (requireEnabled && !s.enabled) return null;
		const src = this.sourceFor(name);
		if (!src) return null;
		let el = this.els[name];
		if (!el || this.elPaths[name] !== src.key) {
			el?.pause();
			el = new Audio(src.url);
			el.preload = "auto";
			el.loop = name !== "endSound";
			this.els[name] = el;
			this.elPaths[name] = src.key;
		}
		el.volume = Math.max(0, Math.min(1, s.volume));
		return el;
	}

	hasSlot(name: SlotName): boolean {
		const s = this.slot(name);
		return s.enabled && !!s.path;
	}

	/** Applies changed settings (volumes, toggles, files) to playing audio. */
	refresh(): void {
		for (const name of ["menuMusic", "spinMusic", "endSound"] as SlotName[]) {
			const el = this.els[name];
			const s = this.slot(name);
			if (!el) continue;
			if (!s.enabled || !s.path || this.elPaths[name] !== s.path) {
				el.pause();
				delete this.els[name];
				delete this.elPaths[name];
			} else {
				el.volume = s.volume;
			}
		}
		this.updateMenu();
	}

	private safePlay(el: HTMLAudioElement, onBlocked?: () => void): void {
		el.play().catch((e: unknown) => {
			if ((e as DOMException)?.name === "NotAllowedError") onBlocked?.();
		});
	}

	/** View open & visible → menu music may play. */
	setMenuActive(active: boolean): void {
		if (this.menuActive === active) return;
		this.menuActive = active;
		this.updateMenu();
	}

	private updateMenu(): void {
		const shouldPlay = this.menuActive && !this.menuPausedForGame;
		const el = shouldPlay ? this.element("menuMusic") : this.els.menuMusic;
		if (!el) return;
		if (shouldPlay) {
			if (el.paused) this.safePlay(el, () => (this.menuBlocked = true));
		} else if (!el.paused) {
			el.pause();
		}
	}

	/** A game (wheel / reel / deal) started. */
	gameStart(): void {
		this.audioCtx();
		this.gameRunning = true;
		this.clearTimers();
		const spin = this.element("spinMusic");
		if (spin) {
			if (this.els.menuMusic && !this.els.menuMusic.paused) {
				this.els.menuMusic.pause();
			}
			this.menuPausedForGame = true;
			spin.volume = this.slot("spinMusic").volume;
			spin.currentTime = 0;
			this.safePlay(spin);
		}
	}

	/**
	 * The game stopped: fade out spin music, play end sound, then resume menu music.
	 * `soundPath` (a slice's own sound) plays instead of the end sound slot.
	 */
	gameEnd(soundPath?: string): void {
		if (!this.gameRunning) return;
		this.gameRunning = false;
		this.clearTimers();
		const spin = this.els.spinMusic;
		if (spin && !spin.paused) this.fadeOut(spin, 300);
		const end = (soundPath ? this.resultElement(soundPath) : null) ?? this.element("endSound");
		const resume = () => {
			this.endTimer = null;
			if (this.gameRunning) return;
			this.menuPausedForGame = false;
			this.updateMenu();
		};
		if (end) {
			end.currentTime = 0;
			end.loop = false;
			const onEnd = () => {
				end.removeEventListener("ended", onEnd);
				resume();
			};
			end.addEventListener("ended", onEnd);
			this.safePlay(end, resume);
			// Safety net in case "ended" never fires.
			const ms = Number.isFinite(end.duration) && end.duration > 0 ? end.duration * 1000 + 500 : 15000;
			this.endTimer = window.setTimeout(resume, Math.min(ms, 30000));
		} else {
			this.endTimer = window.setTimeout(resume, 320);
		}
	}

	/** Game aborted (view closed / game switched): stop everything without the end sound. */
	gameAbort(): void {
		this.gameRunning = false;
		this.clearTimers();
		this.els.spinMusic?.pause();
		this.resultEl?.el.pause();
		this.menuPausedForGame = false;
		this.updateMenu();
	}

	private fadeOut(el: HTMLAudioElement, ms: number): void {
		const start = el.volume;
		const t0 = performance.now();
		const step = () => {
			const k = Math.min(1, (performance.now() - t0) / ms);
			el.volume = Math.max(0, start * (1 - k));
			if (k < 1) {
				this.fadeTimer = window.setTimeout(step, 30);
			} else {
				el.pause();
				el.volume = start;
				this.fadeTimer = null;
			}
		};
		step();
	}

	private clearTimers(): void {
		if (this.fadeTimer !== null) {
			window.clearTimeout(this.fadeTimer);
			this.fadeTimer = null;
			const spin = this.els.spinMusic;
			if (spin) {
				spin.pause();
				spin.volume = this.slot("spinMusic").volume;
			}
		}
		if (this.endTimer !== null) {
			window.clearTimeout(this.endTimer);
			this.endTimer = null;
		}
	}

	/** ▶ preview in the settings: toggles playback of a slot's file. Returns true if now playing. */
	previewSlot(name: SlotName, onStop?: () => void): boolean {
		return this.preview(name, () => this.sourceFor(name), this.slot(name).volume, onStop);
	}

	/** ▶ preview of a slice's own sound (at the end sound's volume). Returns true if now playing. */
	previewFile(path: string, onStop?: () => void): boolean {
		return this.preview(`file:${path}`, () => this.sourceForPath(path), this.slot("endSound").volume, onStop);
	}

	private preview(key: string, source: () => { url: string } | null, volume: number, onStop?: () => void): boolean {
		if (this.previewing) {
			const was = this.previewing;
			was.el.pause();
			this.previewing = null;
			if (was.key === key) return false;
		}
		const src = source();
		if (!src) {
			new Notice("Choose an audio file first.");
			return false;
		}
		const el = new Audio(src.url);
		el.volume = Math.max(0, Math.min(1, volume));
		el.addEventListener("ended", () => {
			if (this.previewing?.el === el) this.previewing = null;
			onStop?.();
		});
		this.previewing = { key, el };
		this.safePlay(el);
		// Long music: a 10 s taste is enough.
		window.setTimeout(() => {
			if (this.previewing?.el === el) {
				el.pause();
				this.previewing = null;
				onStop?.();
			}
		}, 10000);
		return true;
	}

	stopPreview(): void {
		this.previewing?.el.pause();
		this.previewing = null;
	}

	/** Called when the view closes. */
	stopAll(): void {
		this.clearTimers();
		this.stopPreview();
		this.stopTickPreview();
		this.gameRunning = false;
		this.menuPausedForGame = false;
		this.menuActive = false;
		for (const el of Object.values(this.els)) el?.pause();
		this.resultEl?.el.pause();
	}

	destroy(): void {
		this.stopAll();
		for (const el of Object.values(this.els)) {
			if (el) {
				el.removeAttribute("src");
				el.load();
			}
		}
		if (this.resultEl) {
			this.resultEl.el.removeAttribute("src");
			this.resultEl.el.load();
		}
		this.els = {};
		this.elPaths = {};
		this.resultEl = null;
		if (this.ctx) {
			void this.ctx.close().catch(() => undefined);
			this.ctx = null;
			this.master = null;
		}
	}
}
