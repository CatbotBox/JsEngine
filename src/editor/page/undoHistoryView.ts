import {createButton, createElement} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";
import {HISTORY_STATE_HOOK, HISTORY_STEP_HOOK} from "../project/editorUiHooks";
import type {HistoryStepState} from "../project/editorUiHooks";

export const INITIAL_STATE_LABEL = "Initial state";

const ENTRY_CLASS = "undo-history-entry";
const CURRENT_CLASS = "current";
const UNDONE_CLASS = "undone";
const CURRENT_TITLE = "The scene is at this step";
const JUMP_BACK_TITLE = "Undo back to this step";
const JUMP_FORWARD_TITLE = "Redo up to this step";
const CURRENT_STEP = "step";

export class UndoHistoryView {
    private readonly list: HTMLElement;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace) {
        const document = container.ownerDocument;
        this.list = createElement(document, "div", "undo-history-list");
        this.list.setAttribute("role", "list");
        this.list.setAttribute("aria-label", "Undo history");
        container.replaceChildren(this.list);
        workspace.on("state", () => this.render());
        workspace.on("document", () => this.render());
        this.render();
    }

    private render(): void {
        const document = this.list.ownerDocument;
        const {doneOldestFirst, undoneNextFirst} = this.workspace.undo.history;
        const currentDepth = doneOldestFirst.length;
        const labels = [INITIAL_STATE_LABEL, ...doneOldestFirst, ...undoneNextFirst];
        this.list.replaceChildren(...labels.map((label, depth) => {
            const current = depth === currentDepth;
            const undone = depth > currentDepth;
            const classes = [ENTRY_CLASS, current ? CURRENT_CLASS : "", undone ? UNDONE_CLASS : ""].filter(name => name.length > 0).join(" ");
            const title = current ? CURRENT_TITLE : undone ? JUMP_FORWARD_TITLE : JUMP_BACK_TITLE;
            const row = createButton(document, {className: classes, text: label, title, onClick: () => void this.workspace.jumpToHistory(depth)});
            const state: HistoryStepState = current ? "current" : undone ? "undone" : "done";
            row.setAttribute("role", "listitem");
            row.setAttribute(HISTORY_STEP_HOOK, String(depth));
            row.setAttribute(HISTORY_STATE_HOOK, state);
            if (current) row.setAttribute("aria-current", CURRENT_STEP);
            return row;
        }));
    }
}
