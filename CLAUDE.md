# Vault Lottery — notes for Claude

Obsidian plugin (TypeScript, esbuild, no UI framework) with four randomizer games in the right sidebar.
The folder _is_ the installed plugin inside the user's vault (`.obsidian/plugins/Vault Lottery`, id `vaultlottery`).
Original spec: `VAULT_LOTTERY_SPEC.md`.

## Working here

- Build / check: `npm run build` (tsc + esbuild, writes `main.js` in place). Unit tests: `npm test` (vitest, `tests/`).
- The user writes in Hebrew; answer in Hebrew. All plugin UI text stays English.
- Must work on desktop **and** mobile (`isDesktopOnly: false`): no Node/Electron APIs, pointer events (not mouse
  events) for drag, long-press as well as right-click, touch-sized targets under `.is-mobile`, and no hover-only UI.

## Architecture

- `src/games/Game.ts`: the `Game` interface + registry. A new game is a `registerGame()` call in `main.ts`; the view
  (`src/view/LotteryView.ts`) builds tabs from the registry. Games get shared services through `GameContext`
  (audio, confetti, images, announce, busyChanged) and must clean up in `unmount()`.
- All randomness goes through `src/shared/random.ts` (crypto, rejection sampling). Don't use `Math.random`.
- Shared UI: `shared/SavedSetBar.ts` (presets / saved filters / rosters bar), `shared/appearance.ts` (setting
  builders used by both the settings tab and the in-view "Sound & appearance" sections), `shared/ui.ts`.
- Canvas text can't use CSS variables: use `themeFont()` / `themeColor()` from `shared/color.ts`.
- Obsidian `ButtonComponent`s keep their own disabled state: use `setDisabled()`, never just the DOM attribute.

## Testing in real Obsidian (how it was verified)

Obsidian can be driven over CDP without touching the user's vault or profile: generate a test vault, write an
`obsidian.json` that lists only that vault into a fresh profile folder, and start
`%LOCALAPPDATA%\Programs\Obsidian\Obsidian.exe --user-data-dir=<profile> --remote-debugging-port=9333`.
Then `playwright-core`'s `chromium.connectOverCDP` and `page.evaluate` (`app.plugins.enablePluginAndSave`,
`app.commands.executeCommandById`). `app.emulateMobile(true)` + a 390×844 viewport checks the phone layout, and
CDP `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent` checks touch. Close leftover modals before
reloading the plugin. Don't run this against the user's own vault (it syncs with LiveSync).
