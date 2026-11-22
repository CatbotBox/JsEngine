import {openModal} from "./dialogs";
import type {Modal} from "./dialogs";
import {createButton, createElement, errorText} from "./dom";
import {SNAP_KIND_LABELS, SNAP_KINDS, SNAP_STEP_PRESETS, snapStepText} from "./snapSteps";
import type {SnapKind, SnapStepChoice, SnapSteps} from "./snapSteps";
import {uiScaleChoices} from "./uiScale";
import type {UiScale} from "./uiScale";

export interface PreferencesHost {
    readonly document: Document;

    uiScale(): Promise<UiScale>;

    snapSteps(): SnapSteps | undefined;

    setSnapStep(choice: SnapStepChoice): void;
}

export const PREFERENCES_TITLE = "Preferences";

const UI_SCALE_LABEL = "UI scale";
const WINDOW_SCALE_NOTE = "Scales the whole window, the same as Ctrl+=, Ctrl+- and Ctrl+0.";
const PAGE_SCALE_NOTE = "Scales the editor in this browser tab; the browser's own zoom (Ctrl+=, Ctrl+-) also works.";
const SNAP_NOTE = "Snap steps used while snapping is on (the toolbar's Snap button; Ctrl flips it during a handle drag).";
const SNAP_WAITING_NOTE = "Snap steps can be set once the game is connected.";
const CLOSE_TEXT = "Close";

export class PreferencesDialog {
    private readonly modal: Modal;
    private readonly scaleSelect: HTMLSelectElement;
    private closed = false;

    private constructor(private readonly host: PreferencesHost, private readonly onClosed: () => void) {
        const document = host.document;
        this.modal = openModal(document, PREFERENCES_TITLE, () => this.close());
        const scaleField = createElement(document, "label", "editor-modal-field");
        this.scaleSelect = createElement(document, "select", "field-input");
        for (const choice of uiScaleChoices()) {
            const option = createElement(document, "option", "", choice.label);
            option.value = String(choice.factor);
            this.scaleSelect.append(option);
        }
        this.scaleSelect.disabled = true;
        const scaleNote = createElement(document, "p", "editor-modal-message");
        scaleField.append(createElement(document, "span", "", UI_SCALE_LABEL), this.scaleSelect);
        const problem = createElement(document, "p", "editor-modal-problem");
        problem.hidden = true;
        const elements: HTMLElement[] = [scaleField, scaleNote, problem, ...this.snapFields()];
        for (const element of elements) this.modal.dialog.insertBefore(element, this.modal.buttons);
        this.modal.buttons.append(createButton(document, {className: "primary", text: CLOSE_TEXT, title: CLOSE_TEXT, onClick: () => this.close()}));
        void host.uiScale().then(scale => {
            if (this.closed) return;
            scaleNote.textContent = scale.scalesWindow ? WINDOW_SCALE_NOTE : PAGE_SCALE_NOTE;
            this.scaleSelect.value = String(scale.factor);
            this.scaleSelect.disabled = false;
            this.scaleSelect.addEventListener("change", () => {
                problem.hidden = true;
                scale.set(Number(this.scaleSelect.value)).catch(error => {
                    problem.textContent = errorText(error);
                    problem.hidden = false;
                });
            });
            this.scaleSelect.focus();
        });
    }

    public static open(host: PreferencesHost, onClosed: () => void): PreferencesDialog {
        return new PreferencesDialog(host, onClosed);
    }

    public focus(): void {
        this.scaleSelect.focus();
    }

    public close(): void {
        if (this.closed) return;
        this.closed = true;
        this.modal.close();
        this.onClosed();
    }

    private snapFields(): HTMLElement[] {
        const document = this.host.document;
        const steps = this.host.snapSteps();
        if (steps === undefined) return [createElement(document, "p", "editor-modal-message", SNAP_WAITING_NOTE)];
        return [createElement(document, "p", "editor-modal-message", SNAP_NOTE), ...SNAP_KINDS.map(kind => this.snapField(kind, steps[kind]))];
    }

    private snapField(kind: SnapKind, current: number): HTMLElement {
        const document = this.host.document;
        const field = createElement(document, "label", "editor-modal-field");
        const select = createElement(document, "select", "field-input");
        const presets = SNAP_STEP_PRESETS[kind].includes(current) ? SNAP_STEP_PRESETS[kind] : [...SNAP_STEP_PRESETS[kind], current].sort((a, b) => a - b);
        for (const step of presets) {
            const option = createElement(document, "option", "", snapStepText({kind, step}));
            option.value = String(step);
            select.append(option);
        }
        select.value = String(current);
        select.addEventListener("change", () => this.host.setSnapStep({kind, step: Number(select.value)}));
        field.append(createElement(document, "span", "", `${SNAP_KIND_LABELS[kind]} step`), select);
        return field;
    }
}
