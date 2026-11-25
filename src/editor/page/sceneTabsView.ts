import {showCommandMenu} from "./commandMenus";
import {createButton, createElement} from "./dom";
import type {EditorCommands} from "./editorCommands";
import {sceneTabMenu} from "./editorMenus";
import type {EditorWorkspace} from "./editorWorkspace";
import type {EditorSceneTab} from "./sceneDocuments";
import {UNTITLED_SCENE_NAME} from "./sceneTabs";
import {SCENE_TAB_CLOSE_HOOK, SCENE_TAB_HOOK} from "../project/editorUiHooks";

const CLOSE_TEXT = "×";
const ACTIVE_CLASS = "active";
const PREFAB_CLASS = "prefab";
const UNAVAILABLE_CLASS = "unavailable";
const CRUMB_SEPARATOR = "›";
const SWITCH_WHILE_PLAYING_HINT = "stop the game to switch tabs";
const PREFAB_MODE_TEXT = "Prefab";
const MIDDLE_BUTTON = 1;

export class SceneTabsView {
    private renderedKey: string | undefined;

    public constructor(
        private readonly strip: HTMLElement,
        private readonly breadcrumb: HTMLElement,
        private readonly workspace: EditorWorkspace,
        private readonly commands: EditorCommands,
    ) {
        workspace.on("document", () => this.render());
        workspace.on("state", () => this.render());
        this.render();
    }

    private render(): void {
        const scenes = this.workspace.scenes;
        const tabs = scenes.tabs.tabs;
        const active = scenes.activeTab;
        const switchable = this.workspace.mode === "edit" && !this.workspace.closed;
        const key = `${switchable}|${active.key}|${tabs.map(tab => `${tab.key}:${tab.kind}:${tab.label}:${tab.main?.path ?? ""}:${tab.originKey ?? ""}`).join("|")}`;
        if (key === this.renderedKey) return;
        this.renderedKey = key;
        this.strip.replaceChildren(...tabs.map(tab => this.tabElement(tab, tab === active, switchable, tabs.length > 1)));
        this.renderBreadcrumb(active);
    }

    private tabElement(tab: EditorSceneTab, active: boolean, switchable: boolean, closable: boolean): HTMLElement {
        const document = this.strip.ownerDocument;
        const element = createElement(document, "div", "scene-tab");
        element.setAttribute("role", "tab");
        element.setAttribute(SCENE_TAB_HOOK, String(tab.key));
        element.setAttribute("aria-selected", String(active));
        element.classList.toggle(ACTIVE_CLASS, active);
        element.classList.toggle(PREFAB_CLASS, tab.kind === "prefab");
        element.classList.toggle(UNAVAILABLE_CLASS, !active && !switchable);
        const path = tab.main?.path ?? UNTITLED_SCENE_NAME;
        element.title = active || switchable ? path : `${path} (${SWITCH_WHILE_PLAYING_HINT})`;
        element.append(createElement(document, "span", "scene-tab-label", tab.label));
        if (closable) {
            const close = createButton(document, {
                className: "scene-tab-close",
                text: CLOSE_TEXT,
                title: `Close ${tab.name}`,
                onClick: event => {
                    event.stopPropagation();
                    this.commands.scene.closeTab.runWith(tab);
                },
            });
            close.setAttribute(SCENE_TAB_CLOSE_HOOK, "");
            element.append(close);
        }
        element.addEventListener("click", () => void this.workspace.scenes.activate(tab));
        element.addEventListener("auxclick", event => {
            if (event.button !== MIDDLE_BUTTON || !closable) return;
            event.preventDefault();
            this.commands.scene.closeTab.runWith(tab);
        });
        element.addEventListener("contextmenu", event => {
            event.preventDefault();
            showCommandMenu(element.ownerDocument, event.clientX, event.clientY, sceneTabMenu(this.commands, tab, active));
        });
        return element;
    }

    private renderBreadcrumb(active: EditorSceneTab): void {
        const document = this.breadcrumb.ownerDocument;
        const chain = this.workspace.scenes.tabs.breadcrumb(active);
        this.breadcrumb.hidden = active.kind !== "prefab";
        if (this.breadcrumb.hidden) {
            this.breadcrumb.replaceChildren();
            return;
        }
        const parts: HTMLElement[] = [createElement(document, "span", "breadcrumb-mode", PREFAB_MODE_TEXT)];
        chain.forEach((tab, index) => {
            if (index > 0) parts.push(createElement(document, "span", "crumb-separator", CRUMB_SEPARATOR));
            const last = index === chain.length - 1;
            parts.push(last
                ? createElement(document, "span", "crumb current", tab.label)
                : createButton(document, {className: "crumb", text: tab.label, title: `Back to ${tab.name}`, onClick: () => void this.workspace.scenes.activate(tab)}));
        });
        this.breadcrumb.replaceChildren(...parts);
    }
}
