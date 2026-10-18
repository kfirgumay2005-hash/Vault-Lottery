// Shared game interface and registry. New games register a factory here; the view never needs to change.

import type { App } from "obsidian";
import type VaultLotteryPlugin from "../main";
import type { ImageStore } from "../images/ImageStore";
import type { AudioManager } from "../shared/AudioManager";
import type { Confetti } from "../shared/Confetti";

export interface Game {
	id: string;
	name: string;
	icon: string;
	mount(container: HTMLElement): void;
	unmount(): void;
	isBusy(): boolean;
	play(): void;
	/** Optional extra keys while the view is focused (e.g. R = reroll). Return true if handled. */
	handleKey?(e: KeyboardEvent): boolean;
	/** The view became visible / resized; redraw canvases if needed. */
	refresh?(): void;
	/** This game's background settings changed (for games that draw part of it themselves). */
	backgroundChanged?(): void;
}

/** Services the view owns and hands to every game. */
export interface GameContext {
	app: App;
	plugin: VaultLotteryPlugin;
	audio: AudioManager;
	confetti: Confetti;
	images: ImageStore;
	/** Root of the view (for measuring the background aspect ratio, etc.). */
	viewEl: HTMLElement;
	/** aria-live announcement. */
	announce(text: string): void;
	/** Call whenever isBusy() changes so the view can lock/unlock the game switcher. */
	busyChanged(): void;
	/** Fire confetti from an element's center using the plugin's intensity setting. */
	celebrate(from: HTMLElement, colors?: string[], glowEl?: HTMLElement | null): void;
	save(): void;
}

export interface GameDefinition {
	id: string;
	name: string;
	icon: string;
	create(ctx: GameContext): Game;
}

const registry: GameDefinition[] = [];

export function registerGame(def: GameDefinition): void {
	const i = registry.findIndex((g) => g.id === def.id);
	if (i >= 0) registry[i] = def;
	else registry.push(def);
}

export function registeredGames(): readonly GameDefinition[] {
	return registry;
}

export function gameDefinition(id: string): GameDefinition | undefined {
	return registry.find((g) => g.id === id);
}
