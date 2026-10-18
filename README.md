# Vault Lottery

Randomizer games in Obsidian's right sidebar. Works on desktop and mobile.

- **Spin Wheel**: a wheel of fortune with color or cropped-image slices, presets, music and sound effects.
- **Note Lottery**: picks a random note from a filtered part of your vault (folders, tags, properties, dates, name, word count). A slot-machine reel shows the draw, then confetti, then a result card.
- **Dice & Coin**: a coin flip with custom labels (and best of 3/5), plus dice: d4–d100, any `dN`, notation such as `2d6+3`, `4d6kh3` or `2d20kl1`, custom text dice, and hold & reroll. Has an instant mode.
- **Team Picker**: splits a roster into balanced teams (with keep-apart / keep-together rules), picks one person, or shuffles an order. You can drag people between teams afterwards.

## Open it

Use the dice icon in the ribbon, or the command palette: `Open Vault Lottery`, `Open Spin Wheel`, `Open Note Lottery`, `Open Dice & Coin`, `Open Team Picker`.

Other commands:

| Command | What it does |
|---|---|
| Spin Wheel: Spin / Load preset… | Spin, or load a saved slice set |
| Note Lottery: Draw a note / Draw with filter… | Draw with the reel |
| Note Lottery: Open random note (no animation) | Opens a random note from the current filter right away |
| Dice & Coin: Flip a coin / Roll dice / Roll… | Shows the result in a notice (it animates instead when the view shows Dice & Coin) |
| Dice & Coin: Insert roll result / coin flip at cursor | Inserts e.g. `2d6+3 → 12 (4 + 5 + 3)` or `Coin → Yes` |
| Team Picker: Make teams / Load roster… / Pick one (notice) | |

Keyboard (while the view has focus): `Space` / `Enter` plays the current game, `R` rerolls unheld dice.
On touch screens: long-press a die button to remove a die, tap a rolled die to hold it, and drag a name chip to move it to another team.

## Sounds

- Four audio slots: **menu music**, **spin music**, **end sound** (audio files from your vault: mp3, wav, ogg, m4a, flac) and a **tick sound** (5 built-in, synthesized mechanical sounds).
- Dice and coin sounds are synthesized too. No audio files are shipped.
- Menu music pauses while spin music plays, then resumes after the end sound. It also pauses when the sidebar is hidden.

## Images

Slice images, coin faces and backgrounds all go through a crop tool. The crop is locked to the right shape: the slice's wedge for slices, a circle guide for coins, and the shape of the view (or of the wheel area) for a background (or free). Each game has its own background; the wheel's can also fill only the wheel area, behind the wheel. Cropped images are saved as WebP (PNG on iOS) in the folder Obsidian uses for new attachments, not in `data.json`. Sound files and background videos (mp4, looping and muted) are vault files: picked from the vault, or added from the computer into the folder set for new attachments in Obsidian (Settings → Files and links).

## Data

Settings, presets, saved filters, rosters and history are kept in the plugin's `data.json`. In **Settings → Vault Lottery → Data** you can export them to a JSON file in the vault root and import them on another vault or device.

## Development

```bash
npm install
npm run build   # tsc + esbuild → main.js
npm test        # vitest: random.ts, DiceNotation.ts, TeamSplitter.ts
npm run dev     # watch mode
```

## License

[MIT](LICENSE)
