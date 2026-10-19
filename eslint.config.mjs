// Obsidian's review rules (eslint-plugin-obsidianmd), run with `npm run lint`.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

// The plugin's and the games' names are proper names, so they keep their capitals in UI text.
const NAMES = ["Vault Lottery", "Spin Wheel", "Note Lottery", "Dice & Coin", "Team Picker"];

export default defineConfig([
	globalIgnores(["main.js", "node_modules/", "tests/", "esbuild.config.mjs", "vitest.config.mts"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.*"] },
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", {
				brands: [...DEFAULT_BRANDS, ...NAMES],
				// Dice notation ("2d6+3", "4d6kh3") is written in lower case
				ignoreRegex: [String.raw`\b\d*d(\d+|%)\S*`],
			}],
		},
	},
]);
