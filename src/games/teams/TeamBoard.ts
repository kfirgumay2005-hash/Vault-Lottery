// Result board: deck shuffle + deal animation, team columns with drag-between-teams, pick-one and order reveals.

import type { Person } from "../../settings";
import { pick, randomInt, randomRange, shuffle } from "../../shared/random";
import { easeOutQuint } from "../../shared/ui";
import { teamSkill } from "./TeamSplitter";

export interface Team {
	name: string;
	color: string;
	members: Person[];
}

export interface TeamBoardOptions {
	showSkill: () => boolean;
	onMove: (personId: string, from: number, to: number) => void;
	onColor: (team: number, color: string) => void;
	tick: () => void;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => window.setTimeout(r, ms));
}

export class TeamBoard {
	readonly el: HTMLElement;
	private run = 0;
	private raf: number | null = null;
	private drag: { cleanup: () => void } | null = null;

	constructor(parent: HTMLElement, private o: TeamBoardOptions) {
		this.el = parent.createDiv({ cls: "vault-lottery-board" });
	}

	/** Aborts running animations. */
	cancel(): void {
		this.run++;
		if (this.raf !== null) window.cancelAnimationFrame(this.raf);
		this.raf = null;
		this.el.querySelectorAll(".vault-lottery-flying").forEach((n) => n.remove());
	}

	clear(): void {
		this.cancel();
		this.el.empty();
	}

	private personChip(parent: HTMLElement, p: Person, color?: string): HTMLElement {
		const c = parent.createDiv({ cls: "vault-lottery-person-chip", attr: { "data-id": p.id, dir: "auto" } });
		c.setText(p.name || "?");
		if (color ?? p.color) c.style.setProperty("--vl-chip-color", color ?? p.color ?? "");
		return c;
	}

	// ---------- Team mode ----------

	private columns(teams: Team[], hidden: boolean): HTMLElement[] {
		const grid = this.el.createDiv({ cls: "vault-lottery-team-grid" });
		return teams.map((t, i) => {
			const card = grid.createDiv({ cls: "vault-lottery-team-card", attr: { "data-team": String(i) } });
			card.style.setProperty("--vl-team-color", t.color);
			const head = card.createDiv({ cls: "vault-lottery-team-head" });
			const color = head.createEl("input", { type: "color", cls: "vault-lottery-team-color", attr: { "aria-label": `${t.name} color` } });
			color.value = t.color;
			color.addEventListener("input", () => {
				card.style.setProperty("--vl-team-color", color.value);
				this.o.onColor(i, color.value);
			});
			head.createSpan({ cls: "vault-lottery-team-name", text: t.name, attr: { dir: "auto" } });
			const meta = head.createSpan({ cls: "vault-lottery-team-meta" });
			meta.setText(this.meta(t, hidden ? 0 : t.members.length));
			const body = card.createDiv({ cls: "vault-lottery-team-body" });
			if (!hidden) for (const m of t.members) this.personChip(body, m);
			return body;
		});
	}

	private meta(t: Team, count: number): string {
		const members = t.members.slice(0, count);
		let s = `${count}`;
		if (this.o.showSkill()) s += ` · ★ ${teamSkill(members)}`;
		return s;
	}

	/** Final board without animation; chips can be dragged between teams. */
	showTeams(teams: Team[], warning?: string): void {
		this.cancel();
		this.el.empty();
		if (warning) this.el.createDiv({ cls: "vault-lottery-warning", text: warning });
		this.columns(teams, false);
		this.enableDrag();
	}

	async dealTeams(teams: Team[], warning?: string): Promise<void> {
		this.cancel();
		const run = this.run;
		this.el.empty();
		const all = teams.flatMap((t) => t.members);
		const deck = this.el.createDiv({ cls: "vault-lottery-deck" });
		const chips = new Map<string, HTMLElement>();
		for (const p of shuffle(all)) chips.set(p.id, this.personChip(deck, p));
		const bodies = this.columns(teams, true);
		const metas = Array.from(this.el.querySelectorAll<HTMLElement>(".vault-lottery-team-meta"));

		// 1) Shuffle: chips jitter and swap for ~0.6 s
		const t0 = performance.now();
		while (performance.now() - t0 < 600) {
			if (run !== this.run) return;
			for (const c of chips.values()) {
				c.animate(
					[{ transform: "translate(0,0)" }, { transform: `translate(${randomRange(-6, 6)}px, ${randomRange(-5, 5)}px) rotate(${randomRange(-6, 6)}deg)` }, { transform: "translate(0,0)" }],
					{ duration: 150, easing: "ease-in-out" },
				);
			}
			const kids = Array.from(deck.children);
			if (kids.length > 1) {
				const a = pick(kids);
				deck.insertBefore(a, kids[randomInt(0, kids.length - 1)]);
			}
			await sleep(150);
		}
		if (run !== this.run) return;

		// 2) Deal one at a time, round-robin across teams
		const order: { p: Person; team: number }[] = [];
		const maxLen = Math.max(...teams.map((t) => t.members.length));
		for (let r = 0; r < maxLen; r++) teams.forEach((t, ti) => t.members[r] && order.push({ p: t.members[r], team: ti }));
		const per = Math.max(60, Math.min(200, 4000 / Math.max(1, order.length)));
		const counts = teams.map(() => 0);
		const boardRect = () => this.el.getBoundingClientRect();
		for (const { p, team } of order) {
			if (run !== this.run) return;
			const src = chips.get(p.id);
			const target = this.personChip(bodies[team], p);
			target.addClass("is-incoming");
			if (src) {
				const b = boardRect();
				const s = src.getBoundingClientRect();
				const d = target.getBoundingClientRect();
				const fly = this.el.createDiv({ cls: "vault-lottery-person-chip vault-lottery-flying", text: p.name, attr: { dir: "auto" } });
				fly.style.left = `${s.left - b.left}px`;
				fly.style.top = `${s.top - b.top + this.el.scrollTop}px`;
				fly.style.width = `${s.width}px`;
				fly.style.setProperty("--vl-chip-color", teams[team].color);
				src.addClass("is-gone");
				const anim = fly.animate(
					[{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${d.left - s.left}px, ${d.top - s.top}px) scale(1)` }],
					{ duration: per * 1.6, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
				);
				void anim.finished.then(() => {
					fly.remove();
					target.removeClass("is-incoming");
				}).catch(() => fly.remove());
			} else {
				target.removeClass("is-incoming");
			}
			counts[team]++;
			metas[team]?.setText(this.meta(teams[team], counts[team]));
			this.o.tick();
			await sleep(per);
		}
		await sleep(per * 0.8);
		if (run !== this.run) return;
		this.showTeams(teams, warning);
	}

	// ---------- Drag between teams ----------

	private enableDrag(): void {
		this.drag?.cleanup();
		const onDown = (e: PointerEvent) => {
			const chip = (e.target as HTMLElement).closest<HTMLElement>(".vault-lottery-team-body .vault-lottery-person-chip");
			if (!chip || e.button !== 0) return;
			const fromCard = chip.closest<HTMLElement>(".vault-lottery-team-card");
			const from = parseInt(fromCard?.dataset.team ?? "-1");
			const id = chip.dataset.id;
			if (!id || from < 0) return;
			const sx = e.clientX;
			const sy = e.clientY;
			let ghost: HTMLElement | null = null;
			let over: HTMLElement | null = null;
			chip.setPointerCapture(e.pointerId);
			const move = (ev: PointerEvent) => {
				if (!ghost) {
					if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
					const r = chip.getBoundingClientRect();
					ghost = chip.cloneNode(true) as HTMLElement;
					ghost.addClass("vault-lottery-drag-ghost");
					ghost.style.width = `${r.width}px`;
					chip.ownerDocument.body.appendChild(ghost);
					chip.addClass("is-dragging");
				}
				ev.preventDefault();
				ghost.style.left = `${ev.clientX}px`;
				ghost.style.top = `${ev.clientY}px`;
				const under = chip.ownerDocument.elementFromPoint(ev.clientX, ev.clientY);
				const card = under?.closest<HTMLElement>(".vault-lottery-team-card") ?? null;
				if (card !== over) {
					over?.removeClass("is-drop-target");
					over = card && this.el.contains(card) ? card : null;
					over?.addClass("is-drop-target");
				}
			};
			const up = () => {
				chip.removeEventListener("pointermove", move);
				chip.removeEventListener("pointerup", up);
				chip.removeEventListener("pointercancel", up);
				chip.removeClass("is-dragging");
				ghost?.remove();
				over?.removeClass("is-drop-target");
				if (ghost && over) {
					const to = parseInt(over.dataset.team ?? "-1");
					if (to >= 0 && to !== from) this.o.onMove(id, from, to);
				}
			};
			chip.addEventListener("pointermove", move);
			chip.addEventListener("pointerup", up);
			chip.addEventListener("pointercancel", up);
		};
		this.el.addEventListener("pointerdown", onDown);
		this.drag = { cleanup: () => this.el.removeEventListener("pointerdown", onDown) };
	}

	// ---------- Pick one ----------

	async pickOne(people: Person[], winner: Person, durationMs: number, instant: boolean): Promise<HTMLElement> {
		this.cancel();
		const run = this.run;
		this.el.empty();
		const box = this.el.createDiv({ cls: "vault-lottery-pick-box" });
		const name = box.createDiv({ cls: "vault-lottery-pick-name", attr: { dir: "auto" } });
		if (instant) {
			name.setText(winner.name);
			box.addClass("is-win");
			return box;
		}
		const len = randomInt(24, 40);
		const seq: Person[] = [];
		for (let i = 0; i < len; i++) seq.push(pick(people));
		seq.push(winner);
		const N = seq.length - 1;
		const t0 = performance.now();
		let last = -1;
		await new Promise<void>((resolve) => {
			const step = (now: number) => {
				if (run !== this.run) return resolve();
				const t = Math.min(1, (now - t0) / durationMs);
				const idx = Math.min(N, Math.floor(N * easeOutQuint(t) + 0.0001));
				if (idx !== last) {
					last = idx;
					name.setText(seq[idx].name);
					name.removeClass("is-flash");
					void name.offsetWidth;
					name.addClass("is-flash");
					this.o.tick();
				}
				if (t < 1) this.raf = window.requestAnimationFrame(step);
				else {
					this.raf = null;
					resolve();
				}
			};
			this.raf = window.requestAnimationFrame(step);
		});
		name.setText(winner.name);
		box.addClass("is-win");
		return box;
	}

	// ---------- Random order ----------

	async order(list: Person[], instant: boolean): Promise<void> {
		this.cancel();
		const run = this.run;
		this.el.empty();
		const ol = this.el.createEl("ol", { cls: "vault-lottery-order" });
		const items = list.map((p) => {
			const li = ol.createEl("li", { attr: { dir: "auto" } });
			li.createSpan({ text: p.name });
			if (!instant) li.addClass("is-hidden");
			return li;
		});
		if (instant) return;
		const per = Math.max(80, Math.min(320, 4000 / Math.max(1, list.length)));
		for (const li of items) {
			if (run !== this.run) return;
			li.removeClass("is-hidden");
			li.addClass("is-revealed");
			this.o.tick();
			await sleep(per);
		}
	}

	destroy(): void {
		this.cancel();
		this.drag?.cleanup();
		this.el.remove();
	}
}
