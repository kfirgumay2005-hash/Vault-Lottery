# Vault Lottery — Obsidian Plugin Specification

Build an Obsidian community plugin called **Vault Lottery**: a small collection of randomizer games that live in the **right sidebar**. The plugin ships with four games:

1. **Spin Wheel** — a customizable wheel of fortune. Users define slices, give each slice a color or a background image, save slice sets as presets, attach music and sound effects, and style the view's background with a cropped image.
2. **Note Lottery** — randomly picks and opens a note from a user-filtered range of the vault, presented as a slot-machine-style reel with a celebration confetti burst.
3. **Dice & Coin** — fast, real-time decision tools: a coin flip (with custom side labels) and a dice roller (standard and custom dice, dice notation, hold-and-reroll).
4. **Team Picker** — splits a list of people into random teams, picks one person, or produces a random order.

Games share one sidebar view, one audio system, one background system, one image store and one confetti engine. The architecture must make adding more games later straightforward (see §2.1).

**The entire UI is English only.** No i18n layer is needed.

---

## 1. Tech stack & project setup

- TypeScript, based on the official `obsidian-sample-plugin` template (esbuild, `manifest.json`, `main.ts`, `styles.css`).
- Plugin id: `vault-lottery`, name: `Vault Lottery`.
- No heavy UI frameworks. Plain DOM + Obsidian API (`ItemView`, `Modal`, `FuzzySuggestModal`, `Setting`, `PluginSettingTab`, `Notice`, `Menu`).
- Rendering: `<canvas>` elements (use `devicePixelRatio` for sharp rendering, redraw on resize via `ResizeObserver`).
- Audio: HTML `<audio>` elements for user files, Web Audio API for all built-in sounds.
- Must work on desktop and mobile (`isDesktopOnly: false`). Avoid Node/Electron APIs.
- All styling in `styles.css` using Obsidian CSS variables (`--background-primary`, `--interactive-accent`, etc.) so it fits light/dark themes.
- No third-party runtime libraries are required (confetti is implemented in-house, §11).
- All randomness goes through `shared/random.ts`, built on `crypto.getRandomValues` (uniform integer in range without modulo bias, weighted pick, Fisher–Yates shuffle).
- Split code into modules, e.g.:
  ```
  src/
    main.ts                    // plugin entry, commands, view registration
    settings.ts                // data model, defaults, settings tab
    view/LotteryView.ts        // the sidebar ItemView + game switcher
    games/Game.ts              // shared Game interface + registry
    games/wheel/WheelGame.ts
    games/wheel/WheelCanvas.ts // drawing + spin animation
    games/wheel/SliceEditor.ts
    games/wheel/PresetManager.ts
    games/notes/NoteLotteryGame.ts
    games/notes/NoteFilter.ts  // filter model + matching
    games/notes/FilterEditor.ts
    games/notes/SlotReel.ts    // reel drawing + animation
    games/notes/ResultCard.ts
    games/dice/DiceCoinGame.ts
    games/dice/CoinCanvas.ts
    games/dice/DiceTray.ts     // dice drawing + roll animation
    games/dice/DiceNotation.ts // parser for "2d6+3"
    games/teams/TeamPickerGame.ts
    games/teams/RosterEditor.ts
    games/teams/TeamSplitter.ts // splitting algorithms + constraints
    games/teams/TeamBoard.ts    // deal animation + result columns
    shared/AudioManager.ts
    shared/builtinSounds.ts    // synthesized tick / dice / coin sounds
    shared/Confetti.ts
    shared/random.ts
    shared/insertResult.ts     // copy / insert-at-cursor helpers
    images/CropModal.ts
    images/ImageStore.ts
  ```

---

## 2. Opening the view

- Register a custom `ItemView` with view type `vault-lottery-view`, display text `Vault Lottery`, icon `dices` (Lucide).
- It opens in the **right sidebar** (`workspace.getRightLeaf(false)`), and `revealLeaf` it.
- Entry points: a ribbon icon and commands `Open Vault Lottery`, `Open Spin Wheel`, `Open Note Lottery`, `Open Dice & Coin`, `Open Team Picker` (the game-specific ones open the view and switch to that game). If the view is already open, reveal it instead of opening a second one.
- The view must stay usable at narrow sidebar widths (~250px).

### 2.1 Game switcher & game architecture

- At the top of the view: a compact tab strip with one tab per game (icon + name; icon only below ~360px width, with the name as tooltip).
  - Spin Wheel `disc-3` · Note Lottery `ticket` · Dice & Coin `dice-5` · Team Picker `users`.
- The last active game is remembered (`activeGameId`).
- Switching games is disabled while a game is running (spinning/drawing/rolling/dealing).
- Every game implements a shared interface, and is registered in a registry so new games can be added without touching the view:

```ts
interface Game {
  id: string;                       // "wheel" | "notes" | "dice" | "teams" | future ids
  name: string;
  icon: string;                     // Lucide icon name
  mount(container: HTMLElement): void;   // build its UI
  unmount(): void;                  // cleanup: frames, observers, listeners
  isBusy(): boolean;                // true while animating
  play(): void;                     // the main action (used by Space/Enter and commands)
}
```

- Shared services (AudioManager, Confetti, ImageStore, background) are owned by the view/plugin and passed to games — games do not create their own.

---

## 3. Spin Wheel — view layout (top to bottom)

1. **Wheel area** — the canvas, with a fixed pointer at the top (12 o'clock) and a **Spin** button (button below the wheel, and clicking the wheel's center also spins). The wheel scales to the available width.
2. **Result display** — shows the winning slice's label after each spin (large text, colored with the slice's color).
3. **Preset bar** — dropdown to load a preset + buttons: `Save`, `Save as…`, `Rename`, `Delete`.
4. **Slice editor** — collapsible section listing the slices (see §4).
5. **Sound & appearance** — collapsible section with quick access to audio, background and confetti options (same options as the settings tab).

---

## 4. Spin Wheel — slices

Each slice:

```ts
interface Slice {
  id: string;            // stable unique id
  label: string;         // text shown on the wheel and in the result
  fillType: "color" | "image";
  color: string;         // hex, used when fillType === "color" (also as result text color)
  image?: ImageRef;      // used when fillType === "image" (see §12)
  textColor: string;     // hex, default auto-contrast (black/white based on fill luminance)
}
```

Slice editor row: label text input · fill type toggle (Color / Image) · color picker or "Choose image…" button · text color picker · move up/down buttons · delete button.

- `+ Add slice` button. New slices get the next color from a pleasant default palette.
- Minimum 2 slices to spin (disable the Spin button with a tooltip otherwise). Maximum 50.
- All edits redraw the wheel immediately and autosave the current working set.
- Label text on the wheel is drawn radially, auto-shrinks to fit, and is truncated with `…` if still too long.
- **Image slices:** the image is clipped to the wedge shape. The image is placed so the cropped image covers the wedge's bounding area. Picking an image opens the crop modal (§12) before applying.

---

## 5. Spin Wheel — spinning

- The winner is chosen **up front** with a uniform random pick, then the animation is computed to land on it. Land at a random position inside the winning wedge (not exactly at its center, and not exactly on a border).
- Animation: `requestAnimationFrame`, several full rotations (5–8) plus the offset, with an ease-out curve (e.g. ease-out cubic or quart) so it slows down realistically.
- Spin duration setting: 2–15 seconds, default 5.
- The Spin button is disabled while spinning; the slice editor, preset loading and game switching are locked during a spin.
- After landing: show the result, highlight the winning wedge (subtle glow/outline), play the end sound (§10), and fire confetti if enabled for the wheel (§11, off by default for the wheel).
- The wheel keeps its final rotation (the next spin starts from there).

---

## 6. Spin Wheel — presets (saved slice sets)

```ts
interface Preset {
  id: string;
  name: string;
  slices: Slice[];
}
```

- `Save` overwrites the currently loaded preset; `Save as…` asks for a name and creates a new one.
- Loading a preset replaces the current working slices instantly. If the working set has unsaved changes, ask for confirmation first.
- `Rename` and `Delete` (with confirmation) for the selected preset.
- Show an "unsaved changes" dot next to the preset dropdown when the working set differs from the loaded preset.
- Presets store **slices only**. Audio and background are global settings.
- Command palette commands: `Spin Wheel: Load preset…` (fuzzy picker) and `Spin Wheel: Spin`.

---

## 7. Note Lottery

Randomly picks a note from a filtered range of the vault, reveals it with a slot-machine reel, celebrates with confetti, and opens it.

### 7.1 Layout (top to bottom)

1. **Reel window** — a slot-machine frame (rounded box with a subtle metallic/inset border drawn with theme colors) containing one vertical reel of note titles. A horizontal **payline** marks the center row; the rows above and below are partially visible and faded. Two small pointer arrows sit at the payline's left and right edges.
2. **Draw button** — large, labelled `Draw a note` (clicking the reel window also draws). Below it, a small live counter: `142 notes in range`.
3. **Result card** — appears after a draw (§7.5).
4. **Filter bar** — dropdown to load a saved filter + `Save`, `Save as…`, `Rename`, `Delete` (same behavior as wheel presets, including the unsaved-changes dot).
5. **Filter editor** — collapsible section (§7.2).
6. **History** — collapsible list of recent picks (§7.6).
7. **Sound & appearance** — same shared section as the wheel.

### 7.2 Filters

The "range" is the set of markdown notes (`app.vault.getMarkdownFiles()`) that pass **all** active filter rules. Each rule can be enabled/disabled individually.

```ts
interface NoteFilter {
  includeFolders: string[];        // empty = whole vault; subfolders included
  excludeFolders: string[];        // always applied, takes precedence over include
  includeTags: string[];           // without '#'; nested tags match children (#project matches #project/a)
  includeTagsMode: "any" | "all";
  excludeTags: string[];
  property?: { key: string; op: "exists" | "equals" | "contains" | "not-exists"; value?: string };
  modified?: { op: "within" | "older-than"; days: number };
  created?: { op: "within" | "older-than"; days: number };
  nameContains?: string;           // case-insensitive substring of the basename
  minWords?: number;               // optional, skip stubs (computed lazily, see 7.7)
  excludeActiveNote: boolean;      // default true
}
```

- Folder fields use a folder fuzzy picker (chips with ×). Tag fields use a tag picker built from `metadataCache` (chips with ×).
- Tags are read from both inline tags and frontmatter `tags` via `getAllTags(metadataCache.getFileCache(file))`.
- Properties are read from `metadataCache` frontmatter.
- The `N notes in range` counter updates live (debounced ~250ms) as filters change and when the vault changes (`vault.on('create'|'delete'|'rename')`, `metadataCache.on('changed')`).
- A `Preview range` button opens a modal listing the matching notes (scrollable, capped display of 500 with a "+N more" line).
- Global exclusions in settings (applied to every filter): exclude the plugin's export files, and a user-editable list of always-excluded folders (default: the attachments folder if set, and `templates` if it exists).

### 7.3 Selection logic

- The winner is chosen **up front**.
- **Selection mode** setting:
  - `Uniform` (default) — every note in range has equal chance.
  - `Favor forgotten notes` — weight = days since last modified (min 1), so long-untouched notes are more likely. Weighted pick via cumulative weights.
- **No-repeat** setting: `Avoid the last N picks` (0–50, default 10). Notes in the recent history are excluded from the draw when possible; if that would empty the range, ignore this rule for that draw.
- If the range is empty: Draw button disabled, reel shows `No notes match your filters`.
- If exactly one note is in range: still animate (the reel can repeat titles).

### 7.4 Reel animation

- The reel strip is built per draw: a sequence of ~30–60 note titles sampled randomly from the range (repeats allowed when the range is small) with the winner placed at the final stop position. The reel never needs to contain the entire vault — this keeps very large vaults fast.
- Titles are rendered on a canvas (or a translated DOM strip — choose whatever is smoother), one per row, truncated with `…`; the folder path appears in small muted text under each title.
- Animation: `requestAnimationFrame`, translates the strip downward with an ease-out curve (quart/quint), ending with a small **overshoot and settle-back bounce** (~120ms) like a mechanical slot reel. Slight motion blur effect at high speed is optional (e.g. reduced opacity on non-center rows while fast).
- Duration setting (2–15s, default 4s).
- Each time a row crosses the payline, trigger the selected tick sound (§10), with the same throttle (~25ms) as the wheel.
- While drawing: Draw button disabled, filter editor and filter-preset loading locked, game switching locked.
- On stop: the winning row lights up (accent-colored payline glow), the end sound plays, **confetti fires** (§11), and the result card appears.

### 7.5 Result card

- Shows: note title (large), folder path (muted), tags as chips, last-modified date, and an excerpt — the first ~200 characters of the note body with frontmatter stripped, rendered as **plain text** (no HTML injection; Markdown syntax characters may remain or be lightly stripped).
- Buttons: `Open` (current/most recent main leaf), `Open in new tab`, `Draw again`, and a `⋯` menu with `Copy link` (`[[Note]]` via `fileManager.generateMarkdownLink`), `Reveal in file explorer` (if the file explorer is available), and `Exclude this note` (adds it to a per-filter excluded-notes list).
- Clicking the title also opens the note. Ctrl/Cmd-click opens in a new tab (use `Keymap.isModEvent`).
- **Auto-open after draw** setting: `Off` (default) · `Current tab` · `New tab`. When on, the note opens after the celebration delay (~800ms) so the confetti is seen.
- Opening uses `workspace.getLeaf(false|"tab").openFile(file)` and **never** opens the note inside the sidebar leaf.

### 7.6 History

- Keep the last 50 picks: `{ path: string; pickedAt: number }`. Display the most recent 10 with relative times (`2h ago`), each clickable to open. `Clear history` button.
- Renamed notes: update history paths on `vault.on('rename')`. Deleted notes are dropped from history.

### 7.7 Performance

- Range matching uses only `metadataCache` and `TFile.stat` (no file reads) except for `minWords`, which reads files lazily, caches the word count by `path + mtime`, and only runs when that rule is enabled. While counts are being computed, the counter shows `Counting…`.
- Must stay responsive in vaults with 10,000+ notes.

### 7.8 Commands

- `Note Lottery: Draw a note` — opens the view on the Note Lottery game (if not open) and draws with the current filter.
- `Note Lottery: Draw with filter…` — fuzzy picker of saved filters, then draws.
- `Note Lottery: Open random note (no animation)` — instantly opens a random note from the current filter, still recorded in history.

---

## 8. Dice & Coin

Real-time decision tools. The priority is **speed**: a result must be one click (or one keypress) away, animations are short, and there is an instant mode.

### 8.1 Layout (top to bottom)

1. **Mode switch** — segmented control: `Coin` · `Dice`. Remembered.
2. **Stage** — a canvas area where the coin flips or the dice tumble.
3. **Action button** — `Flip` or `Roll` (clicking the stage also triggers it).
4. **Result line** — large text: e.g. `Heads` or `Total: 14  (6 + 5 + 3)`.
5. **Mode options** — collapsible (§8.2 / §8.3).
6. **History** — last 20 results for the current mode, newest first, with a `Clear` button and simple session stats.

### 8.2 Coin

- **Side labels**: editable, default `Heads` / `Tails`. One-click label presets: `Heads / Tails`, `Yes / No`, `Do it / Skip it`. The labels are drawn on the coin faces.
- **Face style**: per side, a color (default gold / silver tones) or an image through the crop modal (§12) with a 1:1 circular mask.
- **Animation** (default 1.2s, range 0.5–4s): the coin rises and falls in an arc while flipping — fake 3D by oscillating the vertical scale (`scaleY = cos(angle)`) and switching which face is drawn when the scale crosses zero, with a darker edge band visible when it is near edge-on. A short bounce/wobble on landing. The outcome is chosen up front and the number of half-turns is computed so the correct face ends up.
- **Best of N**: `Single`, `Best of 3`, `Best of 5`. Flips sequentially (faster per flip) until one side reaches the majority; shows a running score `Yes 2 – 1 No`.
- **Stats**: session counts per side and current streak (`Tails ×3`).
- **Sounds**: a synthesized **coin flip** sound (a short metallic "ting" with fast ring-out at launch) and a **coin land** sound (two or three quick metallic clinks, decaying). See §10.

### 8.3 Dice

- **Quick buttons**: `d4` `d6` `d8` `d10` `d12` `d20` `d100`. Clicking one adds a die of that type to the tray; a long-press / right-click removes one. A `Clear tray` button.
- **Notation input**: a text field accepting standard notation, e.g. `2d6+3`, `d20`, `3d8-1`, `4d6kh3` (keep highest 3), `2d20kl1` (keep lowest 1 — disadvantage). Invalid input shows an inline error and disables Roll. The tray and the notation field stay in sync.
- **Limits**: up to 20 dice per roll; die sides 2–1000 (`dN` allowed for any N).
- **Custom dice**: the user can define named custom dice with 2–20 text faces (e.g. `Dinner: Pizza, Sushi, Burger, Salad, Shawarma, Cook at home`). Saved as a list, addable to the tray like standard dice. Results show the face text.
- **Hold & reroll**: after a roll, clicking a die toggles **hold** (outlined, locked icon). `Reroll` rerolls only the unheld dice. Holds clear on a fresh `Roll`.
- **Drawing**: d6 is drawn as a rounded square with pips; other standard dice are drawn as their characteristic 2D silhouettes (triangle for d4, diamond for d8, pentagon-like for d10/d12, hexagon-outline for d20, rounded square with two digits for d100) with the number centered. Custom dice are drawn as rounded squares with the face text (auto-shrunk / truncated). Dice colors use the accent color by default with an optional custom color per die type.
- **Animation** (default 1.0s, range 0.3–4s): dice tumble across the stage — random rotation and position jitter, faces flickering through random values, decelerating, then a small bounce and settle on the final (pre-chosen) values. Dice must not overlap at rest (simple grid/packing layout that fits the sidebar width; wraps to multiple rows).
- **Results**: each die's value, kept/dropped dice (dropped shown faded with strikethrough), modifier, and total. For a single d20: a natural 20 is highlighted as `Critical!` (accent glow + confetti if enabled) and a natural 1 as `Fumble` (muted red tint).
- **Sounds**: a synthesized **dice rattle** (a burst of 4–10 short filtered-noise clicks with randomized timing, more clicks for more dice) at roll start, and a **dice land** sound (a soft thud per die, slightly staggered). See §10.

### 8.4 Real-time behavior

- `Instant mode` toggle (per mode): skips the animation and shows the result immediately, with only the land sound.
- `Space`/`Enter` flips or rolls when the view is focused; `R` rerolls unheld dice.
- Results are announced via the `aria-live` region.

### 8.5 Commands (work without opening the view)

- `Dice & Coin: Flip a coin` — performs a flip using the saved coin labels and shows the result in a `Notice` (e.g. `🪙 Yes`). If the view is open on Dice & Coin, it animates there instead.
- `Dice & Coin: Roll dice` — rolls the current tray / notation and shows the result in a `Notice`.
- `Dice & Coin: Roll…` — opens a small prompt for notation, rolls, shows a `Notice`.
- `Dice & Coin: Insert roll result at cursor` / `Insert coin flip at cursor` — editor commands that insert a compact result, e.g. `2d6+3 → 12 (4 + 5 + 3)` or `Coin → Yes`.
- All command results are also added to the history.

---

## 9. Team Picker

Splits a roster of people into random teams, picks one person, or produces a random order.

### 9.1 Layout (top to bottom)

1. **Roster bar** — dropdown of saved rosters + `Save`, `Save as…`, `Rename`, `Delete` (same behavior and unsaved-changes dot as wheel presets).
2. **Roster editor** — collapsible (§9.2).
3. **Mode & options** (§9.3).
4. **Go button** — label depends on mode: `Make teams` / `Pick one` / `Shuffle order`.
5. **Result board** — team columns, the picked person, or the ordered list (§9.4).
6. **Result actions** — `Reshuffle`, `Copy as Markdown`, `Insert into note`, `Save as new note`.

### 9.2 Roster

```ts
interface Person {
  id: string;
  name: string;
  present: boolean;   // only present people take part
  skill?: number;     // optional 1–5, used by "Balance by skill"
  color?: string;     // optional chip color
}
interface Roster { id: string; name: string; people: Person[]; keepApart: [string, string][]; keepTogether: [string, string][]; }
```

- Each person is a row/chip with: a **present** checkbox, editable name, optional skill (1–5 stars, hidden unless skill balancing is on), delete.
- `+ Add person`, plus a `Paste list` action: a textarea, one name per line; the optional syntax `Name | 3` sets skill. Duplicates are flagged.
- `Import from note`: pick a note (fuzzy modal); every top-level list item (`- Name` or `- [ ] Name`) becomes a person.
- `All present` / `None present` quick toggles; a counter shows `9 of 12 present`.
- **Constraints** (optional, collapsible): `Keep apart` pairs and `Keep together` pairs, chosen from two dropdowns.
- Edits autosave to the working roster.

### 9.3 Modes & options

- **Split into teams** — choose either `Number of teams` (2–20) or `People per team` (2–50). Remainders are distributed so team sizes differ by at most 1.
- **Pick one** — chooses one present person (e.g. who goes first / who pays). Option: `Don't pick the same person twice in a row`.
- **Random order** — a shuffled ordered list (e.g. speaking order, turn order).
- **Balance by skill** (team mode only): sort by skill with random tie-breaking, then snake-draft into teams, then a few random swap passes between teams that keep the total-skill difference within the minimum found. Without this option: a plain Fisher–Yates shuffle dealt round-robin.
- **Constraints** apply in team mode: try up to ~500 randomized attempts to satisfy all keep-apart / keep-together pairs; if impossible, use the attempt with the fewest violations and show a warning listing them.
- **Team names**: `Team 1…N` (default), `Colors` (Red, Blue, Green…), or `Custom` (editable list). Each team has a color (default palette, editable on the result board).

### 9.4 Animation & result

- **Team mode**: names appear as chips in a central "deck", which is shuffled briefly (chips jitter/swap for ~0.6s), then dealt **one at a time** into team columns (~120–200ms per name, faster for big rosters so the whole deal takes ≤4s), each chip flying from the deck to its column with an ease-out. A tick sound (§10) plays per dealt name.
- **Pick one**: names cycle quickly in a highlight box, slowing down (ease-out, like the reel in §7.4) and landing on the chosen person, with confetti if enabled.
- **Random order**: names are revealed one by one from position 1 down.
- `Instant mode` toggle skips the animation.
- Team columns stack vertically in narrow sidebars (cards with the team name, color strip, member count and, with skill balancing, total skill).
- After the result, chips can be **dragged between teams** to adjust manually (updates totals).
- **Copy as Markdown / Insert into note** output, e.g.:
  ```
  ### Team 1
  - Dana
  - Omer
  ### Team 2
  - Noa
  - Ido
  ```
  Insert targets the cursor in the most recently active Markdown editor; if none, it falls back to copying with a `Notice`. `Save as new note` creates `Teams YYYY-MM-DD HHmm.md` in the vault root (or a folder set in settings) and opens it.

### 9.5 Commands

- `Team Picker: Make teams` — opens the view on Team Picker and runs the current mode.
- `Team Picker: Load roster…` — fuzzy picker.
- `Team Picker: Pick one (notice)` — picks one present person from the current roster and shows a `Notice` without opening the view.

---

## 10. Audio (shared by all games)

There are four independent audio slots, global for the plugin. Each has its own on/off toggle and volume slider (0–100%).

| Slot | When it plays | Source |
|---|---|---|
| **Menu music** | Loops while the view is open and visible | User audio file |
| **Spin music** | Plays (looped) from a game's start until it stops (Spin Wheel, Note Lottery, Team Picker; not Dice & Coin, whose animations are too short) | User audio file |
| **Tick sound** | Ticking during a spin/draw/deal | One of 5 built-in sounds, or None |
| **End sound** | Plays once when the game stops (Spin Wheel, Note Lottery, Team Picker) | User audio file |

Each game may override the tick sound choice (`Use global` by default) — e.g. Note Lottery could use the Metal ratchet while the wheel uses the Plastic flapper. Dice & Coin uses its own dedicated sounds (below) with a single on/off + volume control in its options.

Behavior rules:
- When a game starts and spin music is enabled, **pause** menu music; resume it (from where it paused) after the end sound finishes. If spin music is off, menu music keeps playing under the tick sound.
- Spin music stops when the game stops (short ~300ms fade-out).
- Menu music stops when the view is closed, and pauses when the sidebar is collapsed/hidden or the leaf is not visible.
- User files are picked from the vault (a fuzzy-search modal listing `mp3`, `wav`, `ogg`, `m4a`, `flac` files). Play them via `app.vault.getResourcePath(file)`. Store the vault path. If the file is later missing, show a `Notice` once and treat the slot as empty.
- Each slot has a ▶ preview button in the settings.
- Browsers block autoplay: if menu music fails to start, start it on the user's first interaction with the view.

### Built-in tick sounds (5, synthesized — no audio files shipped)

These are **neutral mechanical sounds, not music**. Generate them with the Web Audio API (short noise bursts and/or oscillator clicks shaped with filters and fast envelopes). Each tick is triggered **every time a slice border passes the pointer** (wheel), **a row crosses the payline** (reel), or **a name is dealt / passes the highlight** (Team Picker), so ticks naturally slow down as the game decelerates.

1. **Wooden clicker** — dry, short, mid-low wooden knock.
2. **Plastic flapper** — classic prize-wheel flap: bright, slightly snappy click.
3. **Metal ratchet** — thin, higher-pitched metallic tick.
4. **Soft tick** — muted, gentle, low-volume tick (for quiet use).
5. **Heavy mechanical clack** — deeper, chunkier clack with a tiny tail.

Add slight random pitch variation (±3–5%) per tick so it doesn't sound robotic. Throttle so ticks never fire faster than ~every 25ms at very high speed. A preview button plays ~1 second of ticks at a demo speed.

### Dice & coin sounds (synthesized)

- **Dice rattle**, **Dice land**, **Coin flip**, **Coin land** — as described in §8.2 / §8.3. Same Web Audio approach, with ±5% random variation each time. Previewable in the Dice & Coin options.

---

## 11. Confetti (shared)

- Implemented in-house in `shared/Confetti.ts`: a transparent `<canvas>` overlay positioned over the **view container only** (not the whole window), `pointer-events: none`, removed when the animation finishes.
- Particle system: 80–200 particles (by intensity), mixed shapes (small rectangles, circles, thin streamers), colors from the theme accent plus a festive palette (for the wheel, the winning slice's color is included; for Team Picker, the team colors). Initial burst from the game's focal point (wheel center, reel window, dice stage, result board) in a cone upward, then gravity, air drag, random spin/flutter (scaleX oscillation to fake 3D rotation), fade out over the last 30% of life. Total duration ~2.5s.
- Settings: `Confetti` on/off per game — Note Lottery default **on**; Spin Wheel **off**; Dice & Coin **on for d20 criticals only**; Team Picker **on** (after teams are dealt / one is picked). `Intensity`: Low / Medium / High (default Medium).
- Respect `prefers-reduced-motion`: if set, replace confetti with a brief non-moving glow on the result, unless the user explicitly enables `Confetti even with reduced motion`.
- Cancel and clean up on view close, game switch, or a new run.

---

## 12. Images & the crop tool

Images are used in three places: the **view background**, **wheel slice backgrounds**, and **coin faces**. All go through the same crop modal **before** being applied.

### Crop modal
- Source: pick an image from the vault (fuzzy modal for `png`, `jpg`, `jpeg`, `webp`, `gif`) **or** import a file from the computer/device (`<input type="file">`).
- Shows the image with a crop rectangle the user can **drag** and **resize** (corner handles), plus a **zoom** slider and a **Reset** button.
- The crop rectangle's **aspect ratio is locked** to the target:
  - View background: the current aspect ratio of the view container (measure it when the modal opens). Also offer an option `Free aspect` for users who prefer it.
  - Slice background: 1:1 (square), since the image is clipped to a wedge.
  - Coin face: 1:1 with a circular overlay guide, since it is clipped to a circle.
- Live preview of the result in a small panel.
- Buttons: `Apply` and `Cancel`.
- On Apply: render the crop to an offscreen canvas, export as WebP (fallback PNG), downscaled to a sensible max size (background: max 1600px on the long side; slices and coin faces: max 600px), and save it through `ImageStore`.

### ImageStore
- Saves processed images into the plugin's folder: `<configDir>/plugins/vault-lottery/images/<uuid>.webp` via `app.vault.adapter.writeBinary`. **Do not** store base64 in `data.json`.
- `ImageRef = { id: string; path: string }`.
- Deleting a slice/preset/background/coin face removes its image file only if nothing else still references it (simple reference check on save).

### View background options
- `None` (theme default) · `Solid color` (color picker) · `Image` (via crop modal).
- For Image: an `Opacity` slider (0–100%) and a `Blur` slider (0–20px) so the content stays readable.
- Applies only to the view container, not the whole sidebar. Shared by all games.

---

## 13. Persistence

Everything is stored with `loadData()` / `saveData()` (except image files, see §12). Debounce saves (~500ms).

```ts
type TickOverride = 0 | 1 | 2 | 3 | 4 | 5;   // 0 = use global

interface PluginData {
  activeGameId: "wheel" | "notes" | "dice" | "teams";
  wheel: {
    workingSlices: Slice[];
    loadedPresetId: string | null;
    presets: Preset[];
    spinDurationSec: number;
    tickSoundOverride: TickOverride;
    confetti: boolean;
  };
  notes: {
    workingFilter: NoteFilter;
    loadedFilterId: string | null;
    savedFilters: { id: string; name: string; filter: NoteFilter; excludedNotes: string[] }[];
    workingExcludedNotes: string[];
    selectionMode: "uniform" | "favor-forgotten";
    avoidLastN: number;
    drawDurationSec: number;
    autoOpen: "off" | "current" | "tab";
    tickSoundOverride: TickOverride;
    confetti: boolean;
    history: { path: string; pickedAt: number }[];
    globalExcludedFolders: string[];
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
      notation: string;                    // current tray, e.g. "2d6+3"
      customDice: { id: string; name: string; faces: string[] }[];
      dieColors: Record<string, string>;   // e.g. { "d20": "#7c3aed" }
      durationSec: number;
      instant: boolean;
    };
    soundsEnabled: boolean;
    soundsVolume: number;
    confettiOnCrit: boolean;
    history: { mode: "coin" | "dice"; text: string; at: number }[];   // last 20 per mode
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
    saveFolder: string;                    // "" = vault root
  };
  confettiIntensity: "low" | "medium" | "high";
  confettiIgnoreReducedMotion: boolean;
  audio: {
    menuMusic: AudioSlot;
    spinMusic: AudioSlot;
    endSound: AudioSlot;
    tickSound: { enabled: boolean; volume: number; soundId: 1 | 2 | 3 | 4 | 5 };
  };
  background: {
    type: "none" | "color" | "image";
    color: string;
    image?: ImageRef;
    opacity: number;
    blur: number;
  };
}
interface AudioSlot { enabled: boolean; volume: number; path: string | null; }
interface CoinFace { type: "color" | "image"; color: string; image?: ImageRef; }
```

Defaults:
- Wheel: 6 example slices (`Option 1`…`Option 6`) with distinct palette colors, spin duration 5s, confetti off.
- Notes: empty filter (whole vault), exclude active note on, uniform mode, avoid last 10, draw duration 4s, auto-open off, confetti on.
- Dice & Coin: mode `coin`, labels `Heads`/`Tails`, gold/silver faces, single flip, coin 1.2s, dice tray `1d6`, dice 1.0s, instant off, sounds on at 70%, confetti on crit.
- Team Picker: empty roster, mode `teams`, split by count = 2, no skill balancing, naming `numbers`, instant off, confetti on.
- Tick sound = Plastic flapper at 60%, all music slots empty, background none, confetti intensity medium, active game `wheel`.

Load data with a deep merge-over-defaults so older saved data never crashes the plugin.

---

## 14. Settings tab

Grouped sections with full controls:
- **General**: default game on open, confetti intensity, reduced-motion override.
- **Spin Wheel**: spin duration, tick sound override, confetti toggle.
- **Note Lottery**: draw duration, selection mode, avoid last N, auto-open, tick sound override, confetti toggle, globally excluded folders, clear history.
- **Dice & Coin**: coin labels and faces, best-of, durations, instant mode per mode, custom dice editor, die colors, sounds on/off + volume + previews, confetti on crit, clear history.
- **Team Picker**: default mode, team naming and custom names, skill balancing default, instant mode, tick sound override, confetti toggle, folder for saved team notes.
- **Audio**: the four slots (toggle, volume, file picker / sound picker, preview, clear).
- **Background**: type, color, image (opens crop modal), opacity, blur, remove.
- **Data**: `Export` (writes a JSON file with wheel presets, saved note filters, custom dice and rosters to the vault root) and `Import` (from a JSON file in the vault; merges, renaming on id/name collisions).

---

## 15. Quality requirements

- No console errors; clean up everything in `onClose` / `onunload` / `Game.unmount` (animation frames, audio, `AudioContext`, observers, vault/metadata event refs via `registerEvent`, listeners, confetti canvases, drag handlers).
- Respect Obsidian plugin guidelines: no `innerHTML` with user content, use `createEl`, no global styles leaking outside the plugin's container classes (prefix classes with `vault-lottery-`).
- Keyboard: tabs and all main action buttons reachable with Tab; `Space`/`Enter` triggers the active game's `play()` when the view is focused (but not while typing in an input).
- Accessibility: results are also announced via an `aria-live` region; game tabs use proper `role="tablist"` semantics; held dice and present/absent toggles expose their state (`aria-pressed` / checkbox).
- Randomness: unit-test `random.ts` (no modulo bias, shuffle uniformity on small sets), `DiceNotation.ts` (valid/invalid notation, keep-highest/lowest), and `TeamSplitter.ts` (sizes differ by ≤1, constraints honored when possible).

---

## 16. Suggested build order

Build and test each milestone before moving on:

1. View in the right sidebar with the game switcher and the `Game` registry (four placeholder games).
2. Spin Wheel: static wheel drawn from default slices.
3. Slice editor (add / edit / reorder / delete, color only) with live redraw and persistence.
4. Spin animation, random winner, result display.
5. Wheel presets (save, save as, load, rename, delete, unsaved indicator).
6. Built-in synthesized tick sounds synced to slice borders.
7. Menu / spin / end audio slots with the pause-resume rules.
8. Crop modal + ImageStore; view background.
9. Image backgrounds for slices.
10. Note Lottery: filter model + filter editor + live range counter + preview modal.
11. Slot reel animation with ticks, result card, open actions.
12. Confetti engine (all games), reduced-motion handling.
13. Note Lottery history, no-repeat, favor-forgotten mode, saved filters, commands.
14. Dice & Coin: coin flip (labels, animation, best-of, stats, sounds, image faces).
15. Dice: notation parser, tray, roll animation, hold & reroll, custom dice, sounds.
16. Dice & Coin commands (Notice results, insert at cursor), instant mode.
17. Team Picker: roster editor, paste/import, saved rosters.
18. Splitting algorithms (count/size, skill balancing, constraints), pick one, random order.
19. Deal animation, result board with drag-between-teams, copy/insert/save-as-note, commands.
20. Settings tab, import/export, polish, mobile check, large-vault performance check.

## 17. Acceptance checklist

General
- [ ] Plugin is named **Vault Lottery** (id `vault-lottery`); opens in the right sidebar from the ribbon and the command palette; never duplicates.
- [ ] Game tabs switch between all four games; switching is locked while a game runs; last game is remembered.
- [ ] Works in light and dark themes and at narrow sidebar widths.

Spin Wheel
- [ ] Slices can be added, renamed, recolored, reordered, deleted; changes survive an Obsidian restart.
- [ ] A slice can use a cropped image instead of a color, clipped cleanly to its wedge.
- [ ] Spin lands inside the pre-chosen winner, ticks slow down with the wheel, result is shown.
- [ ] Presets save and load correctly and survive restarts.

Note Lottery
- [ ] Folder, tag, property, date, name and word-count filters work, alone and combined; the range counter updates live.
- [ ] The reel lands on the pre-chosen note with an overshoot bounce; ticks slow down with the reel.
- [ ] Confetti fires on a win, stays inside the view, and respects reduced motion.
- [ ] The result card opens the note in the main area (current tab / new tab), never inside the sidebar.
- [ ] No-repeat and favor-forgotten modes behave as specified; history survives restarts and follows renames.
- [ ] Stays responsive with 10,000+ notes.

Dice & Coin
- [ ] Coin flip shows the correct pre-chosen face with custom labels; best-of-3/5 stops at the majority.
- [ ] Dice notation (`2d6+3`, `4d6kh3`, `2d20kl1`, `dN`) parses correctly; invalid input is flagged.
- [ ] Hold & reroll rerolls only unheld dice; custom text dice work.
- [ ] Instant mode gives a result with no animation; commands show results in a Notice and can insert at the cursor.
- [ ] Dice and coin sounds are distinct from the tick sounds and are not music.

Team Picker
- [ ] Only present people are used; team sizes differ by at most 1 in both split modes.
- [ ] Skill balancing produces teams with close total skill; keep-apart / keep-together are honored when possible, with a warning otherwise.
- [ ] Pick one and random order work; no-repeat pick avoids the previous person.
- [ ] Deal animation plays with ticks; chips can be dragged between teams afterwards.
- [ ] Copy as Markdown, insert into note and save as new note produce the expected output; rosters survive restarts.

Shared
- [ ] Menu music loops while the view is open, pauses for spin music, resumes after the end sound — in the games that use them.
- [ ] All 5 built-in tick sounds are audibly distinct and are not music.
- [ ] View background image is cropped to the view's aspect ratio before being applied.
