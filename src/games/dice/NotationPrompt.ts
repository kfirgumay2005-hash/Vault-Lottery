// Small prompt for dice notation with live validation ("Dice & Coin: Roll…").

import { App, ButtonComponent, Modal, Setting } from "obsidian";
import type { CustomDie } from "../../settings";
import { parseNotation } from "./DiceNotation";

export class NotationPromptModal extends Modal {
	constructor(app: App, private initial: string, private customDice: CustomDie[], private onRoll: (notation: string) => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Roll dice");
		this.contentEl.addClass("vault-lottery-modal");
		const input = this.contentEl.createEl("input", { type: "text", cls: "vault-lottery-prompt-input", attr: { spellcheck: "false", autocapitalize: "off" } });
		input.value = this.initial;
		input.placeholder = "Dice, like 2d6+3, d20, 4d6kh3 or 2d20kl1";
		const err = this.contentEl.createDiv({ cls: "vault-lottery-error" });
		let rollBtn: ButtonComponent | null = null;
		const validate = () => {
			const r = parseNotation(input.value, this.customDice);
			err.setText(r.ok ? "" : r.error);
			rollBtn?.setDisabled(!r.ok);
			return r.ok;
		};
		const submit = () => {
			if (!validate()) return;
			this.close();
			this.onRoll(input.value.trim());
		};
		input.addEventListener("input", validate);
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				submit();
			}
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				b.setButtonText("Roll").setCta().onClick(submit);
				rollBtn = b;
			});
		validate();
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 30);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
