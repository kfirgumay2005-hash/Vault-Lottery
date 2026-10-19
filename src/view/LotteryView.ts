// The sidebar view: game switcher tabs, shared services, background, keyboard and visibility handling.

import { ItemView, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type VaultLotteryPlugin from "../main";
import { gameDefinition, registeredGames, type Game, type GameContext } from "../games/Game";
import { Confetti } from "../shared/Confetti";
import { paintBackground } from "../shared/background";
import { themeColor } from "../shared/color";
import { gameBackground } from "../settings";

export const VIEW_TYPE = "vault-lottery-view";

const NARROW_PX = 360;
const MEDIUM_PX = 520;

export class LotteryView extends ItemView {
	private game: Game | null = null;
	private gameId: string | null = null;
	private tabsEl!: HTMLElement;
	private tabButtons = new Map<string, HTMLButtonElement>();
	private bodyEl!: HTMLElement;
	private bgEl!: HTMLElement;
	private liveEl!: HTMLElement;
	private confetti!: Confetti;
	private ctx!: GameContext;
	private resizeObs: ResizeObserver | null = null;
	private visTimer: number | null = null;
	private lastVisible = false;
	private lastWidth = 0;

	constructor(leaf: WorkspaceLeaf, private plugin: VaultLotteryPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Vault Lottery";
	}

	getIcon(): string {
		return "dices";
	}

	get activeGameId(): string | null {
		return this.gameId;
	}

	get activeGame(): Game | null {
		return this.game;
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("vault-lottery-view");
		root.tabIndex = -1;
		this.bgEl = root.createDiv({ cls: "vault-lottery-bg" });
		this.tabsEl = root.createDiv({ cls: "vault-lottery-tabs", attr: { role: "tablist", "aria-label": "Games" } });
		this.bodyEl = root.createDiv({ cls: "vault-lottery-body" });
		this.liveEl = root.createDiv({ cls: "vault-lottery-sr-only", attr: { "aria-live": "polite", role: "status" } });

		this.confetti = new Confetti(root, () => themeColor(root, "--interactive-accent", "#7c3aed"));
		this.ctx = {
			app: this.app,
			plugin: this.plugin,
			audio: this.plugin.audio,
			confetti: this.confetti,
			images: this.plugin.images,
			viewEl: root,
			announce: (t) => this.announce(t),
			busyChanged: () => this.updateTabs(),
			celebrate: (from, colors) => this.celebrate(from, colors),
			save: () => this.plugin.saveSoon(),
		};

		this.buildTabs();

		const d = this.plugin.data;
		const initial = d.defaultGame !== "last" ? d.defaultGame : d.activeGameId;
		this.switchGame(gameDefinition(initial) ? initial : registeredGames()[0].id, true);

		// Keyboard: Space / Enter → play, other keys → game
		this.registerDomEvent(root, "keydown", (e: KeyboardEvent) => this.onKey(e));
		// First interaction unlocks audio (autoplay rules, mobile)
		this.registerDomEvent(root, "pointerdown", () => this.plugin.audio.unlock(), { capture: true });

		this.resizeObs = new ResizeObserver(() => this.handleResize());
		this.resizeObs.observe(root);
		this.registerEvent(this.app.workspace.on("layout-change", () => this.checkVisible()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.checkVisible()));
		this.registerEvent(this.app.workspace.on("resize", () => this.checkVisible()));
		this.registerEvent(this.app.workspace.on("css-change", () => this.game?.refresh?.()));
		this.registerDomEvent(document, "visibilitychange", () => this.checkVisible());
		// Sidebar drawers on mobile collapse without layout events; a cheap periodic check covers that.
		this.visTimer = window.setInterval(() => this.checkVisible(), 1000);
		this.checkVisible();
	}

	async onClose(): Promise<void> {
		if (this.visTimer !== null) window.clearInterval(this.visTimer);
		this.visTimer = null;
		this.resizeObs?.disconnect();
		this.resizeObs = null;
		this.unmountGame();
		this.confetti?.cancel();
		this.plugin.audio.stopAll();
		this.contentEl.empty();
	}

	private buildTabs(): void {
		this.tabsEl.empty();
		this.tabButtons.clear();
		for (const def of registeredGames()) {
			const b = this.tabsEl.createEl("button", {
				cls: "vault-lottery-tab",
				attr: { role: "tab", "aria-selected": "false", "aria-label": def.name, "data-game": def.id },
			});
			const ic = b.createSpan({ cls: "vault-lottery-tab-icon" });
			setIcon(ic, def.icon);
			b.createSpan({ cls: "vault-lottery-tab-label", text: def.name });
			b.addEventListener("click", () => this.switchGame(def.id));
			b.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
				e.preventDefault();
				const ids = registeredGames().map((g) => g.id);
				const i = ids.indexOf(def.id);
				const next = ids[(i + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length];
				this.tabButtons.get(next)?.focus();
			});
			this.tabButtons.set(def.id, b);
		}
		this.updateTabs();
	}

	private updateTabs(): void {
		const busy = this.game?.isBusy() ?? false;
		const w = this.contentEl.clientWidth;
		const narrow = w > 0 && w < NARROW_PX;
		const medium = w > 0 && !narrow && w < MEDIUM_PX;
		for (const [id, b] of this.tabButtons) {
			const active = id === this.gameId;
			b.toggleClass("is-active", active);
			b.setAttr("aria-selected", String(active));
			b.tabIndex = active ? 0 : -1;
			b.disabled = busy && !active;
			b.toggleClass("is-disabled", busy && !active);
			const name = gameDefinition(id)?.name ?? id;
			setTooltip(b, busy && !active ? "Wait until the game stops" : narrow || (medium && !active) ? name : "");
		}
		this.contentEl.toggleClass("is-narrow", narrow);
		this.contentEl.toggleClass("is-medium", medium);
		this.contentEl.toggleClass("is-busy", busy);
	}

	/** Switches to a game. Refused while the current game is running. */
	switchGame(id: string, force = false): boolean {
		if (id === this.gameId && this.game) return true;
		if (!force && this.game?.isBusy()) return false;
		const def = gameDefinition(id);
		if (!def) return false;
		this.unmountGame();
		this.gameId = id;
		this.bodyEl.empty();
		this.bodyEl.scrollTop = 0;
		const container = this.bodyEl.createDiv({ cls: `vault-lottery-game vault-lottery-game-${id}` });
		container.setAttr("role", "tabpanel");
		container.setAttr("aria-label", def.name);
		this.game = def.create(this.ctx);
		this.game.mount(container);
		this.applyBackground();
		if (this.plugin.data.activeGameId !== id) {
			this.plugin.data.activeGameId = id as typeof this.plugin.data.activeGameId;
			this.plugin.saveSoon();
		}
		this.updateTabs();
		return true;
	}

	/** Rebuilds the current game's UI (after settings changed elsewhere). Skipped while it runs. */
	rerender(): void {
		if (!this.game || !this.gameId || this.game.isBusy()) return;
		const id = this.gameId;
		const scroll = this.bodyEl.scrollTop;
		this.gameId = null;
		this.switchGame(id, true);
		this.bodyEl.scrollTop = scroll;
	}

	private unmountGame(): void {
		if (!this.game) return;
		const wasBusy = this.game.isBusy();
		this.confetti?.cancel();
		try {
			this.game.unmount();
		} catch (e) {
			console.error("Vault Lottery: unmount failed", e);
		}
		if (wasBusy) this.plugin.audio.gameAbort();
		this.game = null;
	}

	private onKey(e: KeyboardEvent): void {
		if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t) {
			const tag = t.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
			// Buttons and summaries handle Space/Enter themselves.
			if ((e.key === " " || e.key === "Enter") && (tag === "BUTTON" || tag === "SUMMARY" || tag === "A")) return;
		}
		if (!this.game) return;
		if (e.key === " " || e.key === "Enter") {
			e.preventDefault();
			this.plugin.audio.unlock();
			if (!this.game.isBusy()) this.game.play();
			return;
		}
		if (this.game.handleKey?.(e)) e.preventDefault();
	}

	private handleResize(): void {
		const w = this.contentEl.clientWidth;
		if (w !== this.lastWidth) {
			this.lastWidth = w;
			this.updateTabs();
		}
		this.checkVisible();
	}

	isVisible(): boolean {
		if (document.visibilityState !== "visible") return false;
		if (!this.containerEl.isShown()) return false;
		const ws = this.app.workspace;
		const root = this.leaf.getRoot();
		if (root === ws.rightSplit && ws.rightSplit.collapsed) return false;
		if (root === ws.leftSplit && ws.leftSplit.collapsed) return false;
		const r = this.contentEl.getBoundingClientRect();
		return r.width > 1 && r.height > 1;
	}

	private checkVisible(): void {
		const v = this.isVisible();
		if (v !== this.lastVisible) {
			this.lastVisible = v;
			this.plugin.audio.setMenuActive(v);
			if (v) this.game?.refresh?.();
		}
	}

	announce(text: string): void {
		this.liveEl.setText("");
		window.setTimeout(() => this.liveEl.setText(text), 50);
	}

	private celebrate(from: HTMLElement, colors?: string[]): void {
		const r = from.getBoundingClientRect();
		this.confetti.fire({
			x: r.left + r.width / 2,
			y: r.top + r.height / 2,
			colors,
			intensity: this.plugin.data.confettiIntensity,
		});
	}

	/** Shows the active game's background (each game has its own). */
	applyBackground(): void {
		if (!this.bgEl) return;
		this.game?.backgroundChanged?.();
		const bg = this.gameId ? gameBackground(this.plugin.data, this.gameId) : null;
		// A wheel-only background is shown by the wheel itself, behind the wheel.
		paintBackground(this.bgEl, bg && bg.scope !== "wheel" ? bg : null, this.plugin.images, this.app);
	}

	/** Width / height of the view (or of an element in it), for cropping a background to its shape. */
	aspect(selector?: string): number {
		const el = (selector && this.contentEl.querySelector<HTMLElement>(selector)) || this.contentEl;
		const r = el.getBoundingClientRect();
		return r.width > 10 && r.height > 10 ? r.width / r.height : 0.5;
	}
}
