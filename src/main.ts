// Vault Lottery — plugin entry: data, services, view registration, commands.

import { MarkdownView, Notice, Plugin, TFile, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";
import { registerGame } from "./games/Game";
import { DiceCoinGame } from "./games/dice/DiceCoinGame";
import { NotationPromptModal } from "./games/dice/NotationPrompt";
import { addHistory, coinText, flipSeries, rollText } from "./games/dice/diceLogic";
import { NoteLotteryGame } from "./games/notes/NoteLotteryGame";
import { NoteService } from "./games/notes/NoteService";
import { TeamPickerGame } from "./games/teams/TeamPickerGame";
import { pickOne } from "./games/teams/TeamSplitter";
import { WheelGame } from "./games/wheel/WheelGame";
import { ImageStore } from "./images/ImageStore";
import { VaultLotterySettingTab } from "./SettingsTab";
import { AudioManager } from "./shared/AudioManager";
import { EditorTracker, insertAtCursor } from "./shared/insertResult";
import { MediaCleanupModal } from "./shared/MediaCleanupModal";
import { saveAttachment } from "./shared/media";
import { MediaUsage, attachmentFolder, removeFile } from "./shared/mediaUsage";
import { pickFolder, pickItem } from "./shared/modals";
import { LotteryView, VIEW_TYPE } from "./view/LotteryView";
import {
	defaultData, forEachImageRef, mergeDeep, normalizeData, replacePathDeep, type GameId, type ImageRef, type PluginData,
} from "./settings";

const SAVE_DELAY = 500;

export default class VaultLotteryPlugin extends Plugin {
	data!: PluginData;
	audio!: AudioManager;
	images!: ImageStore;
	notes!: NoteService;
	editors!: EditorTracker;
	private saveTimer: number | null = null;
	private gcTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadPluginData();
		const dir = this.manifest.dir ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		this.images = new ImageStore(this.app, dir, (path) => this.trackOwned(path));
		this.audio = new AudioManager(this.app, () => this.data);
		this.notes = new NoteService(this);
		this.editors = new EditorTracker(this.app);

		registerGame({ id: "wheel", name: "Spin Wheel", icon: "disc-3", create: (ctx) => new WheelGame(ctx) });
		registerGame({ id: "notes", name: "Note Lottery", icon: "ticket", create: (ctx) => new NoteLotteryGame(ctx) });
		registerGame({ id: "dice", name: "Dice & Coin", icon: "dice-5", create: (ctx) => new DiceCoinGame(ctx) });
		registerGame({ id: "teams", name: "Team Picker", icon: "users", create: (ctx) => new TeamPickerGame(ctx) });

		this.registerView(VIEW_TYPE, (leaf) => new LotteryView(leaf, this));
		this.addRibbonIcon("dices", "Open Vault Lottery", () => void this.activateView());
		this.addSettingTab(new VaultLotterySettingTab(this.app, this));
		this.registerCommands();

		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.editors.onLeafChange(leaf)));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile) {
				this.notes.onRename(oldPath, file.path);
				if (file.extension !== "md") this.onMediaRename(oldPath, file.path, false);
			} else if (file instanceof TFolder) {
				this.onMediaRename(oldPath, file.path, true);
				// Folder rename: update every path below it
				for (const h of this.data.notes.history) {
					if (h.path.startsWith(oldPath + "/")) h.path = file.path + h.path.slice(oldPath.length);
				}
				this.saveSoon();
			}
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			if (file instanceof TFile) this.notes.onDelete(file.path);
		}));

		this.app.workspace.onLayoutReady(() => {
			this.initGlobalExclusions();
			this.editors.onLeafChange(this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit));
			void this.moveMediaToAttachments().then(() => this.collectMediaGarbage());
		});
	}

	onunload(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.saveData(this.data);
		}
		if (this.gcTimer !== null) window.clearTimeout(this.gcTimer);
		this.audio?.destroy();
	}

	// ---------- Data ----------

	private async loadPluginData(): Promise<void> {
		let saved: unknown = null;
		try {
			saved = await this.loadData();
		} catch (e) {
			console.error("Vault Lottery: could not read data.json, using defaults", e);
		}
		try {
			this.data = normalizeData(mergeDeep(defaultData(), saved));
		} catch (e) {
			console.error("Vault Lottery: saved data was damaged, using defaults", e);
			this.data = defaultData();
		}
	}

	saveSoon(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveData(this.data);
		}, SAVE_DELAY);
	}

	async resetData(): Promise<void> {
		const view = this.getView();
		if (view?.activeGame?.isBusy()) {
			new Notice("Wait until the game stops.");
			return;
		}
		this.data = defaultData();
		this.initGlobalExclusions();
		await this.saveData(this.data);
		this.audio.refresh();
		this.refreshViews();
		this.applyBackground();
		this.scheduleMediaGc();
	}

	/** Defaults for "always excluded" folders: attachments folder (if set) and "templates" (if it exists). */
	private initGlobalExclusions(): void {
		const n = this.data.notes;
		if (n.globalExcludedInitialized) return;
		const out: string[] = [];
		const attach = (this.app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.("attachmentFolderPath");
		if (typeof attach === "string" && attach && attach !== "/" && !attach.startsWith("./") && attach !== ".") {
			const p = normalizePath(attach);
			if (this.app.vault.getAbstractFileByPath(p) instanceof TFolder) out.push(p);
		}
		const root = this.app.vault.getRoot();
		const templates = root.children.find((c) => c instanceof TFolder && c.name.toLowerCase() === "templates");
		if (templates) out.push(templates.path);
		n.globalExcludedFolders = Array.from(new Set([...n.globalExcludedFolders, ...out]));
		n.globalExcludedInitialized = true;
		this.saveSoon();
	}

	// ---------- Media files ----------

	/** Remembers a file the plugin created, so it may be cleaned up once it's replaced. */
	trackOwned(path: string): void {
		if (!this.data.media.owned.includes(path)) this.data.media.owned.push(path);
		this.saveSoon();
	}

	/** Media files are vault files: follow them when they (or their folder) are renamed or moved. */
	private onMediaRename(oldPath: string, newPath: string, folder: boolean): void {
		const changed = replacePathDeep(this.data, oldPath, newPath, folder);
		if (!changed) return;
		this.images.forget(oldPath);
		this.saveSoon();
		this.audio.refresh();
		this.applyBackground();
		this.getView()?.activeGame?.refresh?.();
	}

	/** Copies a file from the old in-plugin folder to the attachment folder. */
	private async copyToAttachments(ref: ImageRef): Promise<string | null> {
		try {
			const data = await this.app.vault.adapter.readBinary(this.images.path(ref));
			const ext = ref.path.split(".").pop() ?? "bin";
			const path = (await saveAttachment(this.app, data, `Vault Lottery ${ref.id.slice(0, 8)}.${ext}`)).path;
			this.trackOwned(path);
			return path;
		} catch (e) {
			console.error("Vault Lottery: could not move a media file", e);
			return null;
		}
	}

	/** Older versions kept images, sounds and videos in the plugin folder: move them to the attachment folder. */
	private async moveMediaToAttachments(): Promise<void> {
		const moved = new Map<string, string | null>();
		const move = async (ref: ImageRef): Promise<string | null> => {
			if (!moved.has(ref.id)) moved.set(ref.id, await this.copyToAttachments(ref));
			return moved.get(ref.id) ?? null;
		};
		let changed = false;
		const refs: ImageRef[] = [];
		forEachImageRef(this.data, (r) => {
			if (this.images.isLegacy(r)) refs.push(r);
		});
		for (const r of refs) {
			const path = await move(r);
			if (path) {
				r.path = path;
				changed = true;
			}
		}
		for (const slot of [this.data.audio.menuMusic, this.data.audio.spinMusic, this.data.audio.endSound]) {
			if (!slot.file) continue;
			const path = await move(slot.file);
			if (path) slot.path = path;
			delete slot.file;
			delete (slot as { fileName?: string }).fileName;
			changed = true;
		}
		for (const g of ["wheel", "notes", "dice", "teams"] as GameId[]) {
			const bg = this.data[g].background;
			if (!bg.video) continue;
			const path = await move(bg.video);
			if (path) bg.videoPath = path;
			else if (bg.type === "video") bg.type = "none";
			delete bg.video;
			delete (bg as { videoName?: string }).videoName;
			changed = true;
		}
		if (changed) {
			this.saveSoon();
			this.audio.refresh();
			this.refreshViews();
			this.applyBackground();
		}
	}

	/** An image was replaced or removed: clean up files nothing uses any more (soon, in the background). */
	releaseImage(ref: ImageRef | undefined): void {
		if (!ref) return;
		this.scheduleMediaGc();
	}

	/** Same, for any media change (sounds, videos, images). */
	scheduleMediaGc(): void {
		if (this.gcTimer !== null) window.clearTimeout(this.gcTimer);
		this.gcTimer = window.setTimeout(() => {
			this.gcTimer = null;
			void this.collectMediaGarbage();
		}, 3000);
	}

	/** The plugin's data as JSON, without the list of its own files (that list doesn't count as "using" them). */
	private dataJson(): string {
		return JSON.stringify({ ...this.data, media: { ...this.data.media, owned: [] } });
	}

	/**
	 * Files the plugin created that its data no longer points at: moved to the trash when "Delete replaced media"
	 * is on and nothing else in the vault uses them, otherwise just forgotten.
	 */
	private async collectMediaGarbage(): Promise<void> {
		const json = this.dataJson();
		await this.images.collectLegacyGarbage(json);
		const m = this.data.media;
		const stale = m.owned.filter((p) => !json.includes(p));
		if (!stale.length) return;
		const usage = m.deleteReplaced ? await MediaUsage.build(this.app, this.manifest.dir ?? "", null) : null;
		for (const path of stale) {
			const f = this.app.vault.getAbstractFileByPath(path);
			// Picked again in the meantime?
			if (this.dataJson().includes(path)) continue;
			if (usage && f instanceof TFile && usage.usedBy(f, 1).length === 0) {
				try {
					await removeFile(this.app, f, m.removeMode === "permanent");
					this.images.forget(path);
				} catch (e) {
					console.error("Vault Lottery: could not delete", path, e);
					continue;
				}
			}
			m.owned = m.owned.filter((p) => p !== path);
		}
		this.saveSoon();
	}

	/** Opens the "Unused media" window for the attachment folder (asks for a folder if there is no fixed one). */
	async openMediaCleanup(): Promise<void> {
		let folder = attachmentFolder(this.app);
		if (!folder) {
			new Notice("Obsidian doesn't use one fixed attachment folder here. Choose the folder to scan.");
			folder = await pickFolder(this.app, "Choose your media folder…");
			if (!folder) return;
		}
		new MediaCleanupModal(
			this.app,
			folder,
			() => this.data.media.removeMode === "permanent",
			() => MediaUsage.build(this.app, this.manifest.dir ?? "", { label: "Vault Lottery", json: this.dataJson() }),
			(paths) => {
				this.data.media.owned = this.data.media.owned.filter((p) => !paths.includes(p));
				for (const p of paths) this.images.forget(p);
				this.saveSoon();
			},
		).open();
	}

	// ---------- View ----------

	getView(): LotteryView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof LotteryView) return leaf.view;
		}
		return null;
	}

	/** Opens (or reveals) the view in the right sidebar, optionally on a game. */
	async activateView(gameId?: GameId): Promise<LotteryView | null> {
		const ws = this.app.workspace;
		let leaf: WorkspaceLeaf | null = ws.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			if (gameId) {
				this.data.activeGameId = gameId;
			}
			leaf = ws.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await ws.revealLeaf(leaf);
		const deferred = leaf as unknown as { loadIfDeferred?: () => Promise<void> };
		if (typeof deferred.loadIfDeferred === "function") await deferred.loadIfDeferred();
		const view = leaf.view instanceof LotteryView ? leaf.view : null;
		if (view && gameId && view.activeGameId !== gameId) {
			if (!view.switchGame(gameId)) {
				new Notice("Wait until the current game stops.");
				return null;
			}
		}
		return view;
	}

	refreshViews(): void {
		const v = this.getView();
		v?.rerender();
	}

	applyBackground(): void {
		this.getView()?.applyBackground();
	}

	viewAspect(selector?: string): number {
		return this.getView()?.aspect(selector) ?? 0.5;
	}

	openSettings(): void {
		const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	/** View open, visible and showing this game? */
	private visibleGame<T>(id: GameId, cls: new (...a: never[]) => T): T | null {
		const v = this.getView();
		if (!v || !v.isVisible() || v.activeGameId !== id) return null;
		const g = v.activeGame;
		return g instanceof cls ? g : null;
	}

	// ---------- Commands ----------

	private registerCommands(): void {
		this.addCommand({ id: "open", name: "Open", callback: () => void this.activateView() });
		this.addCommand({ id: "open-wheel", name: "Open Spin Wheel", callback: () => void this.activateView("wheel") });
		this.addCommand({ id: "open-notes", name: "Open Note Lottery", callback: () => void this.activateView("notes") });
		this.addCommand({ id: "open-dice", name: "Open Dice & Coin", callback: () => void this.activateView("dice") });
		this.addCommand({ id: "open-teams", name: "Open Team Picker", callback: () => void this.activateView("teams") });

		// Spin Wheel
		this.addCommand({
			id: "wheel-spin",
			name: "Spin Wheel: Spin",
			callback: async () => {
				const v = await this.activateView("wheel");
				const g = v?.activeGame;
				if (g instanceof WheelGame) g.play();
			},
		});
		this.addCommand({
			id: "wheel-load-preset",
			name: "Spin Wheel: Load preset…",
			callback: async () => {
				const presets = this.data.wheel.presets;
				if (!presets.length) {
					new Notice("No wheel presets saved yet.");
					return;
				}
				const p = await pickItem(this.app, presets, (x) => x.name, "Load a wheel preset…");
				if (!p) return;
				const v = await this.activateView("wheel");
				const g = v?.activeGame;
				if (g instanceof WheelGame) g.loadPreset(p.id);
			},
		});

		// Note Lottery
		this.addCommand({
			id: "notes-draw",
			name: "Note Lottery: Draw a note",
			callback: async () => {
				const v = await this.activateView("notes");
				const g = v?.activeGame;
				if (g instanceof NoteLotteryGame) g.drawWhenReady();
			},
		});
		this.addCommand({
			id: "notes-draw-with-filter",
			name: "Note Lottery: Draw with filter…",
			callback: async () => {
				const filters = this.data.notes.savedFilters;
				if (!filters.length) {
					new Notice("No saved filters yet. Save one in Note Lottery first.");
					return;
				}
				const f = await pickItem(this.app, filters, (x) => x.name, "Draw with a saved filter…");
				if (!f) return;
				const v = await this.activateView("notes");
				const g = v?.activeGame;
				if (g instanceof NoteLotteryGame) g.loadFilterAndDraw(f.id);
			},
		});
		this.addCommand({
			id: "notes-open-random",
			name: "Note Lottery: Open random note (no animation)",
			callback: async () => {
				const f = await this.notes.openRandom();
				if (!f) new Notice("No notes match the current filter.");
				else this.refreshViewsIfIdle("notes");
			},
		});

		// Dice & Coin
		this.addCommand({
			id: "dice-flip",
			name: "Dice & Coin: Flip a coin",
			callback: () => {
				const g = this.visibleGame("dice", DiceCoinGame);
				if (g) return g.playMode("coin");
				const text = coinText(this.data, flipSeries(this.data.dice.coin.bestOf));
				this.audio.coinLand();
				addHistory(this.data, "coin", text);
				this.saveSoon();
				new Notice(`🪙 ${text}`);
				this.refreshViewsIfIdle("dice");
			},
		});
		this.addCommand({
			id: "dice-roll",
			name: "Dice & Coin: Roll dice",
			callback: () => {
				const g = this.visibleGame("dice", DiceCoinGame);
				if (g) return g.playMode("dice");
				this.rollNotice();
			},
		});
		this.addCommand({
			id: "dice-roll-prompt",
			name: "Dice & Coin: Roll…",
			callback: () => {
				const g = this.visibleGame("dice", DiceCoinGame);
				if (g) return g.openPrompt();
				new NotationPromptModal(this.app, this.data.dice.dice.notation, this.data.dice.dice.customDice, (n) => this.rollNotice(n)).open();
			},
		});
		this.addCommand({
			id: "dice-insert-roll",
			name: "Dice & Coin: Insert roll result into the note",
			editorCallback: (editor) => {
				const r = rollText(this.data);
				if ("error" in r) {
					new Notice(`Dice notation: ${r.error}`);
					return;
				}
				insertAtCursor(editor, r.line);
				addHistory(this.data, "dice", r.line);
				this.audio.diceLand(r.parsed.diceCount);
				this.saveSoon();
				this.refreshViewsIfIdle("dice");
			},
		});
		this.addCommand({
			id: "dice-insert-flip",
			name: "Dice & Coin: Insert coin flip into the note",
			editorCallback: (editor) => {
				const text = coinText(this.data, flipSeries(this.data.dice.coin.bestOf));
				insertAtCursor(editor, `Coin → ${text}`);
				addHistory(this.data, "coin", text);
				this.audio.coinLand();
				this.saveSoon();
				this.refreshViewsIfIdle("dice");
			},
		});

		// Team Picker
		this.addCommand({
			id: "teams-make",
			name: "Team Picker: Make teams",
			callback: async () => {
				const v = await this.activateView("teams");
				const g = v?.activeGame;
				if (g instanceof TeamPickerGame) g.play();
			},
		});
		this.addCommand({
			id: "teams-load-roster",
			name: "Team Picker: Load roster…",
			callback: async () => {
				const rosters = this.data.teams.rosters;
				if (!rosters.length) {
					new Notice("No rosters saved yet.");
					return;
				}
				const r = await pickItem(this.app, rosters, (x) => x.name, "Load a roster…");
				if (!r) return;
				const v = await this.activateView("teams");
				const g = v?.activeGame;
				if (g instanceof TeamPickerGame) g.loadRoster(r.id);
			},
		});
		this.addCommand({
			id: "teams-pick-notice",
			name: "Team Picker: Pick one (notice)",
			callback: () => {
				const t = this.data.teams;
				const people = t.workingRoster.people.filter((p) => p.present && p.name.trim());
				const p = pickOne(people, t.lastPickedId, t.noRepeatPick);
				if (!p) {
					new Notice("No one is marked present in the current roster.");
					return;
				}
				t.lastPickedId = p.id;
				this.saveSoon();
				new Notice(`👉 ${p.name}`);
			},
		});
	}

	private rollNotice(notation?: string): void {
		const r = rollText(this.data, notation);
		if ("error" in r) {
			new Notice(`Dice notation: ${r.error}`);
			return;
		}
		this.audio.diceLand(r.parsed.diceCount);
		addHistory(this.data, "dice", r.line);
		this.saveSoon();
		new Notice(`🎲 ${r.line}`);
		this.refreshViewsIfIdle("dice");
	}

	/** Re-renders the view if it shows `game` and is idle (so new history shows up). */
	private refreshViewsIfIdle(game: GameId): void {
		const v = this.getView();
		if (v && v.activeGameId === game && !v.activeGame?.isBusy()) v.rerender();
	}

	/** The last focused Markdown editor (for inserting results). */
	lastMarkdownView(): MarkdownView | null {
		return this.editors.view();
	}
}
