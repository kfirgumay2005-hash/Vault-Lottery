// Data model, defaults and the deep merge that loads older data safely.

import { SLICE_PALETTE, contrastText } from "./shared/color";
import { uid } from "./shared/random";

export type GameId = "wheel" | "notes" | "dice" | "teams";
export type TickOverride = 0 | 1 | 2 | 3 | 4 | 5; // 0 = use global
export type TickSoundId = 1 | 2 | 3 | 4 | 5;

export interface ImageRef {
	id: string;
	path: string;
}

export interface Slice {
	id: string;
	label: string;
	fillType: "color" | "image";
	color: string;
	image?: ImageRef;
	textColor: string;
	/** Light glow around the label, 0 (none) … 1 (strong). */
	textGlow: number;
}

export interface Preset {
	id: string;
	name: string;
	slices: Slice[];
}

export type FilterRule =
	| "includeFolders"
	| "excludeFolders"
	| "includeTags"
	| "excludeTags"
	| "property"
	| "modified"
	| "created"
	| "nameContains"
	| "minWords";

export interface NoteFilter {
	includeFolders: string[];
	excludeFolders: string[];
	includeTags: string[];
	includeTagsMode: "any" | "all";
	excludeTags: string[];
	property?: { key: string; op: "exists" | "equals" | "contains" | "not-exists"; value?: string };
	modified?: { op: "within" | "older-than"; days: number };
	created?: { op: "within" | "older-than"; days: number };
	nameContains?: string;
	minWords?: number;
	excludeActiveNote: boolean;
	/** Rules switched off by the user (kept, but not applied). */
	disabledRules: FilterRule[];
}

export interface SavedFilter {
	id: string;
	name: string;
	filter: NoteFilter;
	excludedNotes: string[];
}

export interface HistoryPick {
	path: string;
	pickedAt: number;
}

export interface CoinFace {
	type: "color" | "image";
	color: string;
	image?: ImageRef;
}

export interface CustomDie {
	id: string;
	name: string;
	faces: string[];
}

export interface DiceHistoryEntry {
	mode: "coin" | "dice";
	text: string;
	at: number;
}

export interface Person {
	id: string;
	name: string;
	present: boolean;
	skill?: number;
	color?: string;
}

export interface Roster {
	id: string;
	name: string;
	people: Person[];
	keepApart: [string, string][];
	keepTogether: [string, string][];
}

export interface Background {
	type: "none" | "color" | "image" | "video";
	color: string;
	image?: ImageRef;
	/** Looping, muted video (mp4) in the vault. */
	videoPath?: string;
	/** Older versions kept the video in the plugin folder; it is moved to the attachment folder on load. */
	video?: ImageRef;
	opacity: number; // 0..1
	blur: number; // px
	/** Wheel only: behind the whole view, or drawn on the wheel over the slices. */
	scope: "view" | "wheel";
}

export interface AudioSlot {
	enabled: boolean;
	volume: number; // 0..1
	/** Sound file in the vault. */
	path: string | null;
	/** Older versions kept files from the computer in the plugin folder; moved to the attachment folder on load. */
	file?: ImageRef;
}

export interface PluginData {
	activeGameId: GameId;
	defaultGame: GameId | "last";
	wheel: {
		workingSlices: Slice[];
		loadedPresetId: string | null;
		presets: Preset[];
		spinDurationSec: number;
		tickSoundOverride: TickOverride;
		confetti: boolean;
		background: Background;
	};
	notes: {
		workingFilter: NoteFilter;
		loadedFilterId: string | null;
		savedFilters: SavedFilter[];
		workingExcludedNotes: string[];
		selectionMode: "uniform" | "favor-forgotten";
		avoidLastN: number;
		drawDurationSec: number;
		autoOpen: "off" | "current" | "tab";
		tickSoundOverride: TickOverride;
		confetti: boolean;
		history: HistoryPick[];
		globalExcludedFolders: string[];
		globalExcludedInitialized: boolean;
		excludeExportFiles: boolean;
		background: Background;
	};
	dice: {
		mode: "coin" | "dice";
		coin: {
			labels: [string, string];
			faces: [CoinFace, CoinFace];
			bestOf: 1 | 3 | 5;
			durationSec: number;
			instant: boolean;
		};
		dice: {
			notation: string;
			customDice: CustomDie[];
			dieColors: Record<string, string>;
			durationSec: number;
			instant: boolean;
		};
		soundsEnabled: boolean;
		soundsVolume: number;
		history: DiceHistoryEntry[];
		background: Background;
	};
	teams: {
		workingRoster: Roster;
		loadedRosterId: string | null;
		rosters: Roster[];
		mode: "teams" | "pick-one" | "order";
		splitBy: "count" | "size";
		teamCount: number;
		teamSize: number;
		balanceBySkill: boolean;
		teamNaming: "numbers" | "colors" | "custom";
		customTeamNames: string[];
		noRepeatPick: boolean;
		lastPickedId: string | null;
		instant: boolean;
		tickSoundOverride: TickOverride;
		confetti: boolean;
		saveFolder: string;
		background: Background;
	};
	confettiIntensity: "low" | "medium" | "high";
	confettiIgnoreReducedMotion: boolean;
	audio: {
		menuMusic: AudioSlot;
		spinMusic: AudioSlot;
		endSound: AudioSlot;
		tickSound: { enabled: boolean; volume: number; soundId: TickSoundId };
	};
	media: {
		/** Move a file the plugin added to the trash once it is replaced or removed and nothing else uses it. */
		deleteReplaced: boolean;
		/** What removing an unused file does: move it to the trash (recoverable) or delete it for good. */
		removeMode: "trash" | "permanent";
		/** Vault paths of files the plugin created (cropped images, sounds and videos from the computer). */
		owned: string[];
	};
}

export const TICK_SOUND_NAMES: Record<TickSoundId, string> = {
	1: "Wooden clicker",
	2: "Plastic flapper",
	3: "Metal ratchet",
	4: "Soft tick",
	5: "Heavy mechanical clack",
};

export const GAME_NAMES: Record<GameId, string> = {
	wheel: "Spin Wheel",
	notes: "Note Lottery",
	dice: "Dice & Coin",
	teams: "Team Picker",
};

export function makeSlice(index: number, label?: string, id?: string): Slice {
	const color = SLICE_PALETTE[index % SLICE_PALETTE.length];
	return {
		id: id ?? uid(),
		label: label ?? `Option ${index + 1}`,
		fillType: "color",
		color,
		textColor: contrastText(color),
		textGlow: 0,
	};
}

export function defaultBackground(): Background {
	return { type: "none", color: "#1e1e2e", opacity: 0.35, blur: 0, scope: "view" };
}

export function emptyFilter(): NoteFilter {
	return {
		includeFolders: [],
		excludeFolders: [],
		includeTags: [],
		includeTagsMode: "any",
		excludeTags: [],
		excludeActiveNote: true,
		disabledRules: [],
	};
}

export function emptyRoster(): Roster {
	return { id: "working", name: "Roster", people: [], keepApart: [], keepTogether: [] };
}

export function defaultData(): PluginData {
	return {
		activeGameId: "wheel",
		defaultGame: "last",
		wheel: {
			workingSlices: Array.from({ length: 6 }, (_, i) => makeSlice(i, undefined, `default-${i + 1}`)),
			loadedPresetId: null,
			presets: [],
			spinDurationSec: 5,
			tickSoundOverride: 0,
			confetti: false,
			background: defaultBackground(),
		},
		notes: {
			workingFilter: emptyFilter(),
			loadedFilterId: null,
			savedFilters: [],
			workingExcludedNotes: [],
			selectionMode: "uniform",
			avoidLastN: 10,
			drawDurationSec: 4,
			autoOpen: "off",
			tickSoundOverride: 0,
			confetti: true,
			history: [],
			globalExcludedFolders: [],
			globalExcludedInitialized: false,
			excludeExportFiles: true,
			background: defaultBackground(),
		},
		dice: {
			mode: "coin",
			coin: {
				labels: ["Heads", "Tails"],
				faces: [
					{ type: "color", color: "#d4a017" },
					{ type: "color", color: "#a8a9ad" },
				],
				bestOf: 1,
				durationSec: 1.2,
				instant: false,
			},
			dice: {
				notation: "1d6",
				customDice: [],
				dieColors: {},
				durationSec: 1.0,
				instant: false,
			},
			soundsEnabled: true,
			soundsVolume: 0.7,
			history: [],
			background: defaultBackground(),
		},
		teams: {
			workingRoster: emptyRoster(),
			loadedRosterId: null,
			rosters: [],
			mode: "teams",
			splitBy: "count",
			teamCount: 2,
			teamSize: 3,
			balanceBySkill: false,
			teamNaming: "numbers",
			customTeamNames: ["Team A", "Team B"],
			noRepeatPick: false,
			lastPickedId: null,
			instant: false,
			tickSoundOverride: 0,
			confetti: true,
			saveFolder: "",
			background: defaultBackground(),
		},
		confettiIntensity: "medium",
		confettiIgnoreReducedMotion: false,
		audio: {
			menuMusic: { enabled: false, volume: 0.5, path: null },
			spinMusic: { enabled: false, volume: 0.6, path: null },
			endSound: { enabled: false, volume: 0.8, path: null },
			tickSound: { enabled: true, volume: 0.6, soundId: 2 },
		},
		media: { deleteReplaced: true, removeMode: "trash", owned: [] },
	};
}

/** Calls `fn` for every image the plugin data points at (slices, presets, coin faces, backgrounds). */
export function forEachImageRef(d: PluginData, fn: (ref: ImageRef) => void): void {
	const slices = [...d.wheel.workingSlices, ...d.wheel.presets.flatMap((p) => p.slices)];
	for (const s of slices) if (s.image) fn(s.image);
	for (const f of d.dice.coin.faces) if (f.image) fn(f.image);
	for (const g of ["wheel", "notes", "dice", "teams"] as GameId[]) {
		const img = d[g].background.image;
		if (img) fn(img);
	}
}

/**
 * Rewrites every string in the data that equals `oldPath` (a renamed or moved vault file) — or, for a folder,
 * that lies inside it.
 */
export function replacePathDeep(obj: unknown, oldPath: string, newPath: string, folder = false): boolean {
	let changed = false;
	const prefix = oldPath + "/";
	const map = (x: unknown): unknown => {
		if (typeof x !== "string") return x;
		if (x === oldPath) return newPath;
		if (folder && x.startsWith(prefix)) return newPath + x.slice(oldPath.length);
		return x;
	};
	const walk = (v: unknown): void => {
		const entries: [string | number, unknown][] = Array.isArray(v)
			? v.map((x, i) => [i, x])
			: isPlainObject(v) ? Object.entries(v) : [];
		for (const [k, x] of entries) {
			const y = map(x);
			if (y !== x) {
				(v as Record<string | number, unknown>)[k] = y;
				changed = true;
			} else walk(x);
		}
	};
	walk(obj);
	return changed;
}

/** The background of a game (each game has its own). */
export function gameBackground(d: PluginData, id: string): Background | null {
	const sec = (d as unknown as Record<string, { background?: Background } | undefined>)[id];
	return sec && isPlainObject(sec) && sec.background ? sec.background : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep merge of saved data over the defaults. Objects merge key by key; arrays and primitives from the saved
 * data replace the default only when they have the same basic type, so older or damaged data can't crash the plugin.
 * Keys that only exist in the saved data are kept for optional fields (e.g. `image`, `property`).
 */
export function mergeDeep<T>(defaults: T, saved: unknown): T {
	if (saved === undefined || saved === null) return defaults;
	if (Array.isArray(defaults)) return (Array.isArray(saved) ? saved : defaults) as T;
	if (isPlainObject(defaults)) {
		if (!isPlainObject(saved)) return defaults;
		const out: Record<string, unknown> = { ...defaults };
		for (const key of Object.keys(saved)) {
			const d = (defaults as Record<string, unknown>)[key];
			const s = saved[key];
			out[key] = d === undefined ? s : mergeDeep(d, s);
		}
		return out as T;
	}
	if (typeof defaults === typeof saved) return saved as T;
	return defaults;
}

/** Cleans up values after a merge (ranges, enums, array item shapes). */
export function normalizeData(d: PluginData): PluginData {
	const clamp = (v: number, lo: number, hi: number, def: number) =>
		Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
	const games: GameId[] = ["wheel", "notes", "dice", "teams"];
	if (!games.includes(d.activeGameId)) d.activeGameId = "wheel";
	d.wheel.spinDurationSec = clamp(d.wheel.spinDurationSec, 2, 15, 5);
	d.wheel.workingSlices = d.wheel.workingSlices.filter(isPlainObject).map((s, i) => normalizeSlice(s, i));
	if (d.wheel.workingSlices.length === 0) d.wheel.workingSlices = defaultData().wheel.workingSlices;
	d.wheel.presets = d.wheel.presets
		.filter(isPlainObject)
		.map((p) => ({ ...p, slices: (Array.isArray(p.slices) ? p.slices : []).map((s, i) => normalizeSlice(s, i)) }));
	d.notes.drawDurationSec = clamp(d.notes.drawDurationSec, 2, 15, 4);
	d.notes.avoidLastN = Math.round(clamp(d.notes.avoidLastN, 0, 50, 10));
	d.notes.workingFilter = mergeDeep(emptyFilter(), d.notes.workingFilter);
	d.notes.savedFilters = d.notes.savedFilters.filter(isPlainObject).map((f) => ({
		...f,
		filter: mergeDeep(emptyFilter(), f.filter),
		excludedNotes: Array.isArray(f.excludedNotes) ? f.excludedNotes : [],
	}));
	d.notes.history = d.notes.history.filter((h) => isPlainObject(h) && typeof h.path === "string").slice(0, 50);
	d.dice.coin.durationSec = clamp(d.dice.coin.durationSec, 0.5, 4, 1.2);
	d.dice.dice.durationSec = clamp(d.dice.dice.durationSec, 0.3, 4, 1);
	if (![1, 3, 5].includes(d.dice.coin.bestOf)) d.dice.coin.bestOf = 1;
	d.dice.soundsVolume = clamp(d.dice.soundsVolume, 0, 1, 0.7);
	const def = defaultData();
	if (!Array.isArray(d.dice.coin.labels) || d.dice.coin.labels.length !== 2) d.dice.coin.labels = def.dice.coin.labels;
	if (!Array.isArray(d.dice.coin.faces) || d.dice.coin.faces.length !== 2) d.dice.coin.faces = def.dice.coin.faces;
	d.dice.coin.faces = d.dice.coin.faces.map((f, i) => mergeDeep(def.dice.coin.faces[i], f)) as [CoinFace, CoinFace];
	d.teams.workingRoster = normalizeRoster(d.teams.workingRoster);
	d.teams.rosters = d.teams.rosters.filter(isPlainObject).map(normalizeRoster);
	d.teams.teamCount = Math.round(clamp(d.teams.teamCount, 2, 20, 2));
	d.teams.teamSize = Math.round(clamp(d.teams.teamSize, 2, 50, 3));
	for (const slot of [d.audio.menuMusic, d.audio.spinMusic, d.audio.endSound]) {
		slot.volume = clamp(slot.volume, 0, 1, 0.6);
	}
	d.audio.tickSound.volume = clamp(d.audio.tickSound.volume, 0, 1, 0.6);
	if (![1, 2, 3, 4, 5].includes(d.audio.tickSound.soundId)) d.audio.tickSound.soundId = 2;
	if (d.media.removeMode !== "permanent") d.media.removeMode = "trash";
	d.media.owned = Array.from(new Set(d.media.owned.filter((p) => typeof p === "string" && p)));
	// Older versions had one background for all games: give each game a copy.
	const legacy = (d as unknown as { background?: unknown }).background;
	delete (d as unknown as { background?: unknown }).background;
	delete (d.dice as unknown as { confettiOnCrit?: unknown }).confettiOnCrit;
	for (const g of games) {
		const sec = d[g] as { background: Background };
		if (isPlainObject(legacy)) sec.background = mergeDeep(defaultBackground(), legacy);
		const bg = sec.background;
		if (!["none", "color", "image", "video"].includes(bg.type)) bg.type = "none";
		if ((bg.type === "image" && !bg.image) || (bg.type === "video" && !bg.videoPath && !bg.video)) bg.type = "none";
		if (bg.scope !== "wheel" || g !== "wheel") bg.scope = "view";
		bg.opacity = clamp(bg.opacity, 0, 1, 0.35);
		bg.blur = clamp(bg.blur, 0, 20, 0);
	}
	return d;
}

function normalizeSlice(s: unknown, i: number): Slice {
	const base = makeSlice(i);
	const m = mergeDeep(base, s);
	// Older image slices always had a light glow behind the label: keep that look.
	if (isPlainObject(s) && s.textGlow === undefined && m.fillType === "image") m.textGlow = 0.4;
	m.textGlow = Number.isFinite(m.textGlow) ? Math.max(0, Math.min(1, m.textGlow)) : 0;
	if (m.fillType !== "image" || !m.image) m.fillType = m.fillType === "image" && m.image ? "image" : "color";
	return m;
}

export function normalizeRoster(r: unknown): Roster {
	const m = mergeDeep(emptyRoster(), r);
	m.people = m.people
		.filter(isPlainObject)
		.map((p, i) => mergeDeep<Person>({ id: `p${i}`, name: "", present: true }, p));
	m.keepApart = m.keepApart.filter((p) => Array.isArray(p) && p.length === 2);
	m.keepTogether = m.keepTogether.filter((p) => Array.isArray(p) && p.length === 2);
	return m;
}
