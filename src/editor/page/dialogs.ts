import {createButton, createElement} from "./dom";

export interface TextPromptOptions {
    readonly title: string;
    readonly label: string;
    readonly initialValue: string;
    readonly confirmText: string;
    readonly validate?: (value: string) => string | undefined;
}

export interface ChoiceOption<T> {
    readonly label: string;
    readonly value: T;
    readonly primary?: boolean;
}

export interface ChoiceOptions<T> {
    readonly title: string;
    readonly message: string;
    readonly choices: readonly ChoiceOption<T>[];
}

const CANCEL_TEXT = "Cancel";

export interface Modal {
    readonly dialog: HTMLElement;
    readonly buttons: HTMLElement;

    close(): void;
}

export function openModal(document: Document, title: string, onCancel: () => void): Modal {
    const previousFocus = document.activeElement;
    const backdrop = createElement(document, "div", "editor-modal-backdrop");
    const dialog = createElement(document, "div", "editor-modal");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", title);
    const heading = createElement(document, "h2", "editor-modal-title", title);
    const buttons = createElement(document, "div", "editor-modal-buttons");
    dialog.append(heading, buttons);
    backdrop.append(dialog);
    const onKeyDown = (event: KeyboardEvent): void => {
        event.stopPropagation();
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
    };
    backdrop.addEventListener("keydown", onKeyDown);
    backdrop.addEventListener("pointerdown", event => {
        if (event.target === backdrop) onCancel();
    });
    document.body.append(backdrop);
    return {
        dialog,
        buttons,
        close: () => {
            backdrop.remove();
            if (previousFocus instanceof HTMLElement) previousFocus.focus();
        },
    };
}

export function askForText(document: Document, options: TextPromptOptions): Promise<string | undefined> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (value: string | undefined): void => {
            if (settled) return;
            settled = true;
            modal.close();
            resolve(value);
        };
        const modal = openModal(document, options.title, () => finish(undefined));
        const label = createElement(document, "label", "editor-modal-field");
        const input = createElement(document, "input", "field-input");
        input.type = "text";
        input.spellcheck = false;
        input.value = options.initialValue;
        const problem = createElement(document, "p", "editor-modal-problem");
        problem.hidden = true;
        label.append(createElement(document, "span", "", options.label), input);
        const submit = (): void => {
            const reason = options.validate?.(input.value);
            if (reason !== undefined) {
                problem.textContent = reason;
                problem.hidden = false;
                return;
            }
            finish(input.value);
        };
        input.addEventListener("keydown", event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
        });
        modal.dialog.insertBefore(label, modal.buttons);
        modal.dialog.insertBefore(problem, modal.buttons);
        modal.buttons.append(
            createButton(document, {className: "", text: CANCEL_TEXT, title: CANCEL_TEXT, onClick: () => finish(undefined)}),
            createButton(document, {className: "primary", text: options.confirmText, title: options.confirmText, onClick: submit}),
        );
        input.focus();
        input.select();
    });
}

export interface SavePathOptions {
    readonly title: string;
    readonly folders: readonly string[];
    readonly folder: string;
    readonly name: string;
    readonly extension: string;
    readonly rootLabel: string;
    readonly confirmText: string;
    readonly validate?: (folder: string, name: string) => string | undefined;
}

export interface ChosenSavePath {
    readonly folder: string;
    readonly name: string;
}

export function askForSavePath(document: Document, options: SavePathOptions): Promise<ChosenSavePath | undefined> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (value: ChosenSavePath | undefined): void => {
            if (settled) return;
            settled = true;
            modal.close();
            resolve(value);
        };
        const modal = openModal(document, options.title, () => finish(undefined));
        const folderLabel = createElement(document, "label", "editor-modal-field");
        const folder = createElement(document, "select", "field-input");
        for (const path of options.folders) {
            const option = createElement(document, "option", "", path.length === 0 ? options.rootLabel : path);
            option.value = path;
            folder.append(option);
        }
        folder.value = options.folder;
        folderLabel.append(createElement(document, "span", "", "Folder"), folder);
        const nameLabel = createElement(document, "label", "editor-modal-field");
        const nameRow = createElement(document, "span", "editor-modal-name");
        const name = createElement(document, "input", "field-input");
        name.type = "text";
        name.spellcheck = false;
        name.value = options.name;
        nameRow.append(name, createElement(document, "span", "editor-modal-extension", options.extension));
        nameLabel.append(createElement(document, "span", "", "Name"), nameRow);
        const problem = createElement(document, "p", "editor-modal-problem");
        problem.hidden = true;
        const submit = (): void => {
            const reason = options.validate?.(folder.value, name.value);
            if (reason !== undefined) {
                problem.textContent = reason;
                problem.hidden = false;
                return;
            }
            finish({folder: folder.value, name: name.value.trim()});
        };
        name.addEventListener("keydown", event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
        });
        for (const element of [folderLabel, nameLabel, problem]) modal.dialog.insertBefore(element, modal.buttons);
        modal.buttons.append(
            createButton(document, {className: "", text: CANCEL_TEXT, title: CANCEL_TEXT, onClick: () => finish(undefined)}),
            createButton(document, {className: "primary", text: options.confirmText, title: options.confirmText, onClick: submit}),
        );
        name.focus();
        name.select();
    });
}

export function askForChoice<T>(document: Document, options: ChoiceOptions<T>): Promise<T | undefined> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (value: T | undefined): void => {
            if (settled) return;
            settled = true;
            modal.close();
            resolve(value);
        };
        const modal = openModal(document, options.title, () => finish(undefined));
        modal.dialog.insertBefore(createElement(document, "p", "editor-modal-message", options.message), modal.buttons);
        let primary: HTMLButtonElement | undefined;
        for (const choice of options.choices) {
            const button = createButton(document, {className: choice.primary === true ? "primary" : "", text: choice.label, title: choice.label, onClick: () => finish(choice.value)});
            if (choice.primary === true) primary = button;
            modal.buttons.append(button);
        }
        modal.buttons.append(createButton(document, {className: "", text: CANCEL_TEXT, title: CANCEL_TEXT, onClick: () => finish(undefined)}));
        (primary ?? modal.buttons.querySelector("button"))?.focus();
    });
}
