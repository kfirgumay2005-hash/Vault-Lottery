# Vault Lottery — notes for Claude

Obsidian plugin (TypeScript, esbuild, no UI framework) with four randomizer games in the right sidebar.
The folder _is_ the installed plugin inside the user's vault (`.obsidian/plugins/Vault Lottery`, id `vaultlottery`).
Repo: https://github.com/kfirgumay2005-hash/Vault-Lottery (MIT).

## Working here

- Build / check: `npm run build` (tsc + esbuild, writes `main.js` in place). Unit tests: `npm test` (vitest, `tests/`).
  Lint: `npm run lint` — Obsidian's review rules (`eslint-plugin-obsidianmd`); keep it at 0 problems, the community
  review runs the same checks. Also no duplicate CSS properties, no `!important`, no `:has()` in `styles.css`.
- `minAppVersion` is 1.13.0 (declarative settings API, `setDestructive`); don't use APIs newer than that.
- Settings tab is declarative (`getSettingDefinitions` + `getControlValue`/`setControlValue` with dotted keys into
  the plugin data); no `display()`.
- The user writes in Hebrew; answer in Hebrew. All plugin UI text stays English.
- Must work on desktop **and** mobile (`isDesktopOnly: false`): no Node/Electron APIs, pointer events (not mouse
  events) for drag, long-press as well as right-click, touch-sized targets under `.is-mobile`, and no hover-only UI.

## Architecture

- `src/games/Game.ts`: the `Game` interface + registry. A new game is a `registerGame()` call in `main.ts`; the view
  (`src/view/LotteryView.ts`) builds tabs from the registry. Games get shared services through `GameContext`
  (audio, confetti, images, announce, busyChanged) and must clean up in `unmount()`.
- All randomness goes through `src/shared/random.ts` (crypto, rejection sampling). Don't use `Math.random`.
- Shared UI: `shared/SavedSetBar.ts` (presets / saved filters / rosters bar), `shared/appearance.ts` (setting
  builders for the in-view "Sound & appearance" sections), `shared/ui.ts`.
- Canvas text can't use CSS variables: use `themeFont()` / `themeColor()` from `shared/color.ts`.
- Obsidian `ButtonComponent`s keep their own disabled state: use `setDisabled()`, never just the DOM attribute.

## Product decisions (the user's, keep them)

- **Settings tab = neutral options only**: General (game on open, confetti intensity / reduced motion), Media, Data.
  Every game-specific option, the sounds and the background live inside the game's own window. Don't add game
  settings to the settings tab.
- **Each game has its own background** (`data.<game>.background`): none / color / image / looping muted video.
  The wheel's can also be "Wheel area only" — a layer behind the wheel canvas, never over the slices.
- **Media are vault files** in Obsidian's attachment folder (`saveAttachment` in `shared/media.ts`; the user's is
  `Images`): cropped images, and sounds / videos added from the computer. Files the plugin created are listed in
  `data.media.owned`; only those are cleaned up when replaced (trash or permanent, `data.media.removeMode`), and only
  if `MediaUsage` finds no other use in the vault. Picked-from-vault files are never deleted automatically.
  Data that points at vault paths follows renames (`replacePathDeep`).
- Slice images are cropped to the slice's wedge (`wedgeAspect`); labels have a per-slice glow slider (`textGlow`).
- No confetti on a natural 20 (the "Critical!" highlight stays).

## Behavior rules (from the original spec)

- Every game picks its result **up front** with `random.ts`, then animates to land on it.
- Games lock the game switcher and their editors while running (`isBusy()`); Space/Enter = `play()` when the view
  is focused and not typing; results go to the `aria-live` region; tabs use `role="tablist"`.
- Note Lottery: range matching uses only `metadataCache` / `TFile.stat` (file reads only for the min-words rule,
  cached by path + mtime); must stay responsive with 10,000+ notes. Notes open in the main area, never in the
  sidebar leaf.
- Audio: built-in ticks and dice/coin sounds are synthesized (Web Audio, no shipped files), ticks throttled to ~25ms.
  Spin music pauses menu music, which resumes after the end sound; menu music only plays while the view is visible.
- Confetti stays inside the view and respects `prefers-reduced-motion` (glow instead) unless overridden.
- Obsidian guidelines: no `innerHTML` with user content (`createEl`), classes prefixed `vault-lottery-`, clean up
  frames / audio / observers / listeners (`registerEvent`, `unmount`, `onClose`).
- Unit tests cover `random.ts`, `DiceNotation.ts`, `TeamSplitter.ts` and the settings helpers.

## Releasing

Bump the version in `manifest.json`, `package.json` and `versions.json`, `npm run build`, commit and push, then
`gh release create <version>` (tag = the version exactly, no "v") with `main.js`, `manifest.json`, `styles.css`.
`data.json` (the user's data), `main.js` and `node_modules` are git-ignored.

## Testing in real Obsidian (how it was verified)

Obsidian can be driven over CDP without touching the user's vault or profile: generate a test vault, write an
`obsidian.json` that lists only that vault into a fresh profile folder, and start
`%LOCALAPPDATA%\Programs\Obsidian\Obsidian.exe --user-data-dir=<profile> --remote-debugging-port=9333`.
Then `playwright-core`'s `chromium.connectOverCDP` and `page.evaluate` (`app.plugins.enablePluginAndSave`,
`app.commands.executeCommandById`). `app.emulateMobile(true)` + a 390×844 viewport checks the phone layout, and
CDP `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent` checks touch. Close leftover modals before
reloading the plugin. The installed Obsidian may be older than `minAppVersion`: drop the official
`obsidian-<ver>.asar` (from the obsidian-releases GitHub release, gunzipped) into the test profile folder and that
version runs. Since 1.14 the settings open in a separate window (another CDP page with `.mod-settings`).
The plugin id is `vaultlottery` (`app.plugins.plugins.vaultlottery`). Don't run this against the user's own vault (it syncs with LiveSync).
