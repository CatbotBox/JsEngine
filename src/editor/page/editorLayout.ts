import type {Entity} from "../../engine/core";
import type {SceneJsonObject, SceneJsonValue} from "../../engine/scene";
import type {EditorFieldValue, EditorMode, EditorPlayState} from "../editorProtocol";
import {ComponentPanel} from "./componentPanel";
import {downloadText, EditorToolbar, SCENE_FILE_NAME, sceneLoadStatus, sceneSaveStatus} from "./editorToolbar";
import {EntityTreeView} from "./entityTree";
import {InspectorRefresh} from "./inspectorRefresh";
import type {EditorRequester} from "./inspectorRefresh";
import {RotationEulerCache} from "./rotationEulerCache";

export interface EditorLayout {
    readonly root: HTMLElement;
    readonly toolbar: HTMLElement;
    readonly tree: HTMLElement;
    readonly viewport: HTMLElement;
    readonly inspector: HTMLElement;
}

export const EDITOR_VIEWPORT_ID = "viewport";

const STARTING_PLAY_STATE: EditorPlayState = {mode: "edit", gameplayTicks: 0};

function region<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className: string, ariaLabel: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    element.setAttribute("aria-label", ariaLabel);
    return element;
}

export function createEditorLayout(host: HTMLElement): EditorLayout {
    const document = host.ownerDocument;
    const root = region(document, "div", "editor", "Editor");
    const toolbar = region(document, "header", "editor-toolbar", "Toolbar");
    const tree = region(document, "nav", "editor-tree", "Entities");
    const viewport = region(document, "main", "editor-viewport", "Viewport");
    viewport.id = EDITOR_VIEWPORT_ID;
    const inspector = region(document, "aside", "editor-inspector", "Inspector");
    root.append(toolbar, tree, viewport, inspector);
    host.append(root);
    return {root, toolbar, tree, viewport, inspector};
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function mountEditorViews(layout: EditorLayout, client: EditorRequester): Promise<void> {
    const {components} = await client.request({op: "describeSchemas"});
    const document = layout.root.ownerDocument;
    const rotations = new RotationEulerCache();

    const reportError = (error: unknown): void => toolbar.showError(errorMessage(error));
    const run = (work: () => Promise<void>): void => {
        toolbar.showMessage("");
        void work().catch(reportError);
    };
    const showPlayState = (state: EditorPlayState): void => {
        refresh.setMode(state.mode);
        toolbar.showPlayState(state);
    };
    const createAndSelect = (parent: Entity | undefined): void => run(async () => {
        const created = await refresh.edit(parent === undefined ? {op: "createEntity"} : {op: "createEntity", parent});
        refresh.select(created.entity);
    });

    const toolbar = new EditorToolbar(layout.toolbar, {
        setMode: (mode: EditorMode) => run(async () => showPlayState(await refresh.edit({op: "setMode", mode}))),
        step: () => run(async () => showPlayState(await refresh.edit({op: "step"}))),
        createEntity: () => createAndSelect(undefined),
        save: () => run(async () => {
            const saved = await client.request({op: "saveScene"});
            downloadText(document, SCENE_FILE_NAME, saved.sceneText);
            toolbar.showMessage(sceneSaveStatus(saved.report));
        }),
        load: sceneText => run(async () => {
            const loaded = await refresh.edit({op: "loadScene", sceneText});
            refresh.select(undefined);
            showPlayState(STARTING_PLAY_STATE);
            toolbar.showMessage(sceneLoadStatus(loaded));
        }),
    });

    const tree = new EntityTreeView(layout.tree, {
        select: entity => refresh.select(entity),
        addChild: parent => createAndSelect(parent),
        destroy: entity => run(async () => {
            const {destroyed} = await refresh.edit({op: "destroyEntity", entity});
            const selected = refresh.selected;
            if (selected !== undefined && destroyed.includes(selected)) refresh.select(undefined);
        }),
    });

    const panel = new ComponentPanel(layout.inspector, components, {
        setField: async (entity: Entity, typeName: string, key: string, value: SceneJsonValue): Promise<EditorFieldValue | undefined> => {
            toolbar.showMessage("");
            try {
                return (await refresh.edit({op: "setField", entity, typeName, key, value})).value;
            } catch (error) {
                reportError(error);
                return undefined;
            }
        },
        addComponent: (entity: Entity, typeName: string, values: SceneJsonObject) => run(async () => {
            await refresh.edit({op: "addComponent", entity, typeName, values});
        }),
        removeComponent: (entity, typeName) => run(async () => {
            await refresh.edit({op: "removeComponent", entity, typeName});
        }),
        setEnabled: (entity, enabled) => run(async () => {
            await refresh.edit({op: "setEnabled", entity, enabled});
        }),
        reportInvalid: message => toolbar.showError(message),
    }, rotations);

    const refresh = new InspectorRefresh(client, {
        showEntities: entities => {
            tree.showEntities(entities);
            panel.showEntityChoices(entities);
            rotations.retainEntities(new Set(entities.map(summary => summary.entity)));
        },
        showSelection: entity => tree.showSelection(entity),
        showSelectedEntity: details => panel.showEntity(details),
        reportError,
    });
    refresh.start();
}
