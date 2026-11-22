import type {Key} from "../../engine/input/key";
import {
    PIXEL_SCALE_LIMITS,
    PROJECT_TARGETS,
    TARGET_DEFAULT_BACKENDS,
    TARGET_RENDER_BACKENDS,
    targetDrawsPixels,
} from "../../engine/project/projectTargets";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import {createButton, createElement} from "./dom";
import {
    bindingOfCapturedKey,
    bindingText,
    INPUT_BUTTON_NAMES,
    INPUT_KEY_NAMES,
    isModifierKey,
    withActionMoved,
    withActionRenamed,
    withBinding,
    withNewAction,
    withoutAction,
    withoutBinding,
} from "./inputMapDraft";
import type {InputBinding, InputMapDraft} from "./inputMapDraft";
import {projectFileKind} from "./projectFiles";
import {DEFAULT_TARGET_SETTING} from "./projectManifestEdits";
import type {ManifestDraft, ManifestProblemArea, TargetDraft} from "./projectManifestEdits";
import {DEFAULT_INPUT_MAP_PATH} from "./projectSettingsModel";
import type {ProjectSettingsModel} from "./projectSettingsModel";
import {datalistOf, formRow, selectOf, showProblems, StringListEditor, textInput} from "./settingsForm";

export type ProjectSettingsTabName = "manifest" | "inputMap" | "render";

export interface ProjectSettingsTabContext {
    readonly document: Document;
    readonly model: ProjectSettingsModel;
    readonly typeNames: () => readonly string[];
    readonly keyOfEvent?: (event: KeyboardEvent) => Key | undefined;
    rebuild(): void;
}

export interface ProjectSettingsTab {
    readonly element: HTMLElement;

    showState(): void;
}

export const PROJECT_SETTINGS_TAB_LABELS: Readonly<Record<ProjectSettingsTabName, string>> = {manifest: "Manifest", inputMap: "Input Map", render: "Render"};
export const PROJECT_SETTINGS_TABS: readonly ProjectSettingsTabName[] = ["manifest", "inputMap", "render"];

const TARGET_LABELS: Readonly<Record<ProjectTarget, string>> = {web: "Web", window: "Window", terminal: "Terminal"};
const TARGET_BACKEND_HINTS: Readonly<Record<ProjectTarget, string>> = {
    web: "The backend the web page starts with when its URL has no ?backend=.",
    window: "The backend jsengine run and jsengine package open the desktop window with.",
    terminal: "The terminal draws cells.",
};
const PIXEL_SCALE_HINT = `Device pixels per framebuffer pixel (${PIXEL_SCALE_LIMITS.min} to ${PIXEL_SCALE_LIMITS.max}); empty follows the screen's pixel ratio. ?scale= still overrides it.`;
const PIXEL_SCALE_PLACEHOLDER = "screen's pixel ratio";
const PASS_SETTINGS_NOTE = "Per-backend render settings (PixelRenderSettings, MeshPixelPassSettings, CellRenderSettings, ...) are components on the start scene's settings entity; select it in the Hierarchy to edit them.";
const UNDECLARED_TARGET_TEXT = "Not a target of this project; tick it under Targets on the Manifest tab.";
const LOADING_TEXT = "Loading…";
const NO_START_SCENE_LABEL = "(none: the game starts empty)";
const MISSING_SUFFIX = " (missing)";
const GENERATED_ENTRY_LABEL = "Generated bootstrap (jsengine generate writes it)";
const OWN_ENTRY_LABEL = "Own module";
const OWN_ENTRY_PLACEHOLDER = "src/main.ts";
const ENTRY_HINT = "Editor play and every build start from the entry. An own module exports startProject and may import the generated lists.";
const TARGETS_HINT = "Leaving every target ticked with no render settings keeps \"targets\" out of the manifest (every target).";
const TYPE_NAME_PLACEHOLDER = "Type name";
const SYSTEM_NAME_PLACEHOLDER = "System class name";
const SCHEMAS_HINT = "Component and resource types the generated schema list leaves out.";
const SYSTEMS_HINT = "System classes the generated system lists leave out.";
const KEEP_HINT = "Types only named at runtime (a prefab from a computed path, a lookup by name), kept when stripping a build.";
const INPUT_MAP_UNBOUND_TEXT = "This project binds no InputMap resource, so its code cannot resolve input actions.";
const MANIFEST_DIRTY_REASON = "Save or revert the manifest first";
const NO_ACTIONS_TEXT = "No actions yet. Add one, then give it keys, chords or mouse buttons.";
const LISTEN_TEXT = "Listen…";
const LISTENING_TEXT = "Press a key… (click to cancel)";
const UNNAMED_KEY_TEXT = "That key has no engine name; pick it from the list instead";
const ADD_KEY_TEXT = "Add key…";
const ADD_BUTTON_TEXT = "Add mouse button…";
const NO_CHOICE = "";
const GENERATED_FOLDER_PREFIX = "generated/";
const MOVE_UP = -1;
const MOVE_DOWN = 1;
const WITH_MODIFIERS = true;
const CAPTURE: AddEventListenerOptions = {capture: true};
const ACTION_NAME_CLASS = "input-map-name";
const UNSUPPORTED_SUFFIX = " (not supported)";

function section(document: Document, title: string): HTMLElement {
    const element = createElement(document, "section", "settings-section");
    element.append(createElement(document, "h3", "settings-section-title", title));
    return element;
}

function sortedPaths(paths: Iterable<string>, keep: (path: string) => boolean): string[] {
    return [...paths].filter(keep).sort((a, b) => a.localeCompare(b));
}

function loadingTab(document: Document, text: string): ProjectSettingsTab {
    const element = createElement(document, "div", "project-settings-tab");
    element.append(createElement(document, "p", "settings-form-hint", text));
    return {element, showState: () => undefined};
}

function brokenManifestTab(document: Document, problems: readonly string[]): ProjectSettingsTab {
    const element = createElement(document, "div", "project-settings-tab");
    const list = createElement(document, "div", "settings-form-problems");
    showProblems(list, problems);
    element.append(createElement(document, "p", "settings-form-hint", "Fix jsengine.project.json by hand (Project panel, Open in Editor), then reopen Project Settings."), list);
    return {element, showState: () => undefined};
}

class ProblemSlots {
    private readonly slots = new Map<ManifestProblemArea, HTMLElement>();

    public add(area: ManifestProblemArea, element: HTMLElement): void {
        this.slots.set(area, element);
    }

    public show(problems: ReadonlyMap<ManifestProblemArea, readonly string[]>): void {
        for (const [area, element] of this.slots) showProblems(element, problems.get(area));
    }
}

function manifestDraftOf(model: ProjectSettingsModel): ManifestDraft | undefined {
    const manifest = model.manifest;
    return manifest?.kind === "loaded" ? manifest.draft : undefined;
}

export function buildManifestTab(context: ProjectSettingsTabContext): ProjectSettingsTab {
    const {document, model} = context;
    const manifest = model.manifest;
    if (manifest === undefined) return loadingTab(document, LOADING_TEXT);
    if (manifest.kind === "broken") return brokenManifestTab(document, manifest.problems);
    const draft = (): ManifestDraft => manifestDraftOf(model) ?? manifest.draft;
    const edit = (change: (current: ManifestDraft) => ManifestDraft): void => model.setManifestDraft(change(draft()));
    const element = createElement(document, "div", "project-settings-tab");
    const slots = new ProblemSlots();
    const general = createElement(document, "div", "settings-form-problems");
    slots.add("general", general);
    const typeNames = datalistOf(document, context.typeNames());
    const codeFiles = datalistOf(document, sortedPaths(model.projectFiles, path => projectFileKind(path) === "code" && !path.startsWith(GENERATED_FOLDER_PREFIX)));

    const project = section(document, "Project");
    const name = formRow(document, "Name", textInput(document, draft().name, value => edit(current => ({...current, name: value}))));
    slots.add("name", name.problem);

    const entryControl = createElement(document, "div", "settings-entry");
    const radioName = `${typeNames.id}-entry`;
    const generatedRadio = createElement(document, "input");
    generatedRadio.type = "radio";
    generatedRadio.name = radioName;
    generatedRadio.checked = draft().entry === null;
    const ownRadio = createElement(document, "input");
    ownRadio.type = "radio";
    ownRadio.name = radioName;
    ownRadio.checked = draft().entry !== null;
    const ownPath = textInput(document, draft().entry ?? "", value => edit(current => ({...current, entry: value})), OWN_ENTRY_PLACEHOLDER);
    ownPath.setAttribute("list", codeFiles.id);
    ownPath.disabled = draft().entry === null;
    generatedRadio.addEventListener("change", () => {
        ownPath.disabled = true;
        edit(current => ({...current, entry: null}));
    });
    ownRadio.addEventListener("change", () => {
        ownPath.disabled = false;
        edit(current => ({...current, entry: ownPath.value}));
        ownPath.focus();
    });
    const generatedLabel = createElement(document, "label", "settings-choice");
    generatedLabel.append(generatedRadio, document.createTextNode(GENERATED_ENTRY_LABEL));
    const ownLabel = createElement(document, "label", "settings-choice");
    ownLabel.append(ownRadio, document.createTextNode(OWN_ENTRY_LABEL));
    const ownRow = createElement(document, "div", "settings-choice-row");
    ownRow.append(ownLabel, ownPath);
    entryControl.append(generatedLabel, ownRow);
    const entry = formRow(document, "Entry", entryControl, ENTRY_HINT);
    slots.add("entry", entry.problem);

    const scenes = sortedPaths(model.projectFiles, path => projectFileKind(path) === "scene");
    const currentScene = draft().startScene;
    const sceneChoices = [
        {value: NO_CHOICE, label: NO_START_SCENE_LABEL},
        ...(currentScene.length > 0 && !scenes.includes(currentScene) ? [{value: currentScene, label: currentScene + MISSING_SUFFIX}] : []),
        ...scenes.map(path => ({value: path, label: path})),
    ];
    const startScene = formRow(document, "Start scene", selectOf(document, sceneChoices, currentScene, value => edit(current => ({...current, startScene: value}))));
    slots.add("startScene", startScene.problem);

    const targetChecks = createElement(document, "div", "settings-targets");
    for (const target of PROJECT_TARGETS) {
        const label = createElement(document, "label", "settings-choice");
        const check = createElement(document, "input");
        check.type = "checkbox";
        check.checked = draft().targets[target].declared;
        check.addEventListener("change", () => edit(current => ({...current, targets: {...current.targets, [target]: {...current.targets[target], declared: check.checked}}})));
        label.append(check, document.createTextNode(TARGET_LABELS[target]));
        targetChecks.append(label);
    }
    const targets = formRow(document, "Targets", targetChecks, TARGETS_HINT);
    slots.add("targets", targets.problem);
    project.append(name.row, entry.row, startScene.row, targets.row);

    const lists = section(document, "Generated lists");
    const listRow = (label: string, area: ManifestProblemArea, values: readonly string[], placeholder: string, hint: string, change: (values: readonly string[]) => (current: ManifestDraft) => ManifestDraft, suggestions?: HTMLDataListElement) => {
        const editor = new StringListEditor(document, {values, placeholder, suggestions, onChange: next => edit(change(next))});
        const row = formRow(document, label, editor.element, hint);
        slots.add(area, row.problem);
        return row.row;
    };
    lists.append(
        listRow("Schemas: exclude", "schemasExclude", draft().schemasExclude, TYPE_NAME_PLACEHOLDER, SCHEMAS_HINT, next => current => ({...current, schemasExclude: next}), typeNames),
        listRow("Systems: exclude", "systemsExclude", draft().systemsExclude, SYSTEM_NAME_PLACEHOLDER, SYSTEMS_HINT, next => current => ({...current, systemsExclude: next})),
        listRow("Keep", "keep", draft().keep, TYPE_NAME_PLACEHOLDER, KEEP_HINT, next => current => ({...current, keep: next}), typeNames),
    );
    element.append(typeNames, codeFiles, general, project, lists);
    return {element, showState: () => slots.show(model.manifestCheck()?.problems ?? new Map())};
}

function backendChoices(target: ProjectTarget, current: string): {value: string, label: string}[] {
    const allowed: readonly string[] = TARGET_RENDER_BACKENDS[target];
    const unsupported = current === DEFAULT_TARGET_SETTING || allowed.includes(current) ? [] : [{value: current, label: current + UNSUPPORTED_SUFFIX}];
    return [
        {value: DEFAULT_TARGET_SETTING, label: `Default (${TARGET_DEFAULT_BACKENDS[target]})`},
        ...allowed.map(backend => ({value: backend, label: backend})),
        ...unsupported,
    ];
}

export function buildRenderTab(context: ProjectSettingsTabContext): ProjectSettingsTab {
    const {document, model} = context;
    const manifest = model.manifest;
    if (manifest === undefined) return loadingTab(document, LOADING_TEXT);
    if (manifest.kind === "broken") return brokenManifestTab(document, manifest.problems);
    const element = createElement(document, "div", "project-settings-tab");
    const slots = new ProblemSlots();
    const editTarget = (target: ProjectTarget, change: (current: TargetDraft) => TargetDraft): void => {
        const draft = manifestDraftOf(model);
        if (draft !== undefined) model.setManifestDraft({...draft, targets: {...draft.targets, [target]: change(draft.targets[target])}});
    };
    for (const target of PROJECT_TARGETS) {
        const settings = manifest.draft.targets[target];
        const part = section(document, TARGET_LABELS[target]);
        if (!settings.declared) {
            part.append(createElement(document, "p", "settings-form-hint", UNDECLARED_TARGET_TEXT));
            element.append(part);
            continue;
        }
        const backend = selectOf(document, backendChoices(target, settings.backend), settings.backend, value => editTarget(target, current => ({...current, backend: value})));
        backend.disabled = TARGET_RENDER_BACKENDS[target].length === 1 && settings.backend === DEFAULT_TARGET_SETTING;
        const backendRow = formRow(document, "Backend", backend, TARGET_BACKEND_HINTS[target]);
        part.append(backendRow.row);
        if (targetDrawsPixels(target)) {
            const scale = textInput(document, settings.pixelScale, value => editTarget(target, current => ({...current, pixelScale: value})), PIXEL_SCALE_PLACEHOLDER);
            scale.inputMode = "numeric";
            part.append(formRow(document, "Pixel scale", scale, PIXEL_SCALE_HINT).row);
        }
        const problems = createElement(document, "div", "settings-form-problems");
        part.append(problems);
        slots.add(`targets.${target}`, problems);
        element.append(part);
    }
    element.append(createElement(document, "p", "settings-form-hint", PASS_SETTINGS_NOTE));
    return {element, showState: () => slots.show(model.manifestCheck()?.problems ?? new Map())};
}

export class BindingListener {
    private stop: (() => void) | undefined;
    private actionIndex: number | undefined;

    public listeningTo(index: number): boolean {
        return this.stop !== undefined && this.actionIndex === index;
    }

    public start(index: number, target: HTMLElement, keyOfEvent: (event: KeyboardEvent) => Key | undefined, captured: (binding: InputBinding) => void, unnamed: () => void): void {
        this.cancel();
        this.actionIndex = index;
        let heldModifier: Key | undefined;
        const finish = (key: Key, event: KeyboardEvent, withModifiers: boolean): void => {
            const binding = bindingOfCapturedKey({key, ctrl: withModifiers && event.ctrlKey, alt: withModifiers && event.altKey, shift: withModifiers && event.shiftKey, meta: withModifiers && event.metaKey});
            if (binding === undefined) {
                unnamed();
                return;
            }
            this.cancel();
            captured(binding);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            event.preventDefault();
            event.stopPropagation();
            const key = keyOfEvent(event);
            if (key === undefined) {
                unnamed();
                return;
            }
            if (isModifierKey(key)) {
                heldModifier = key;
                return;
            }
            finish(key, event, WITH_MODIFIERS);
        };
        const onKeyUp = (event: KeyboardEvent): void => {
            event.preventDefault();
            event.stopPropagation();
            const key = keyOfEvent(event);
            if (key !== undefined && key === heldModifier) finish(key, event, !WITH_MODIFIERS);
        };
        target.addEventListener("keydown", onKeyDown, CAPTURE);
        target.addEventListener("keyup", onKeyUp, CAPTURE);
        this.stop = () => {
            target.removeEventListener("keydown", onKeyDown, CAPTURE);
            target.removeEventListener("keyup", onKeyUp, CAPTURE);
        };
    }

    public cancel(): void {
        this.stop?.();
        this.stop = undefined;
        this.actionIndex = undefined;
    }
}

function inputMapMessage(document: Document, text: string, action?: HTMLElement): ProjectSettingsTab {
    const element = createElement(document, "div", "project-settings-tab");
    element.append(createElement(document, "p", "settings-form-hint", text));
    if (action !== undefined) element.append(action);
    return {element, showState: () => undefined};
}

export function buildInputMapTab(context: ProjectSettingsTabContext, keyListener: BindingListener): ProjectSettingsTab {
    const {document, model} = context;
    const inputMap = model.inputMap;
    if (model.manifest === undefined) return loadingTab(document, LOADING_TEXT);
    if (inputMap.kind === "unbound" || inputMap.kind === "missing") {
        const path = inputMap.kind === "missing" ? inputMap.path : DEFAULT_INPUT_MAP_PATH;
        const text = inputMap.kind === "missing" ? `The manifest binds the input map to ${path}, which does not exist.` : INPUT_MAP_UNBOUND_TEXT;
        const create = createButton(document, {className: "primary", text: `Create ${path}`, title: `Write an empty input map to ${path}${inputMap.kind === "unbound" ? " and bind it under \"resources\"" : ""}`, onClick: () => void model.createInputMap()});
        create.disabled = model.manifestDirty;
        if (model.manifestDirty) create.title = MANIFEST_DIRTY_REASON;
        return inputMapMessage(document, text, create);
    }
    if (inputMap.kind === "broken") {
        const tab = inputMapMessage(document, `${inputMap.path} cannot be edited here; fix it by hand:`);
        const problems = createElement(document, "div", "settings-form-problems");
        showProblems(problems, inputMap.problems);
        tab.element.append(problems);
        return tab;
    }
    const element = createElement(document, "div", "project-settings-tab input-map-tab");
    const draft = (): InputMapDraft => model.inputMap.kind === "loaded" ? model.inputMap.draft : inputMap.draft;
    const structural = (change: (current: InputMapDraft) => InputMapDraft, focusIndex: number): void => {
        model.setInputMapDraft(change(draft()));
        context.rebuild();
        const names = [...document.querySelectorAll<HTMLInputElement>(`.${ACTION_NAME_CLASS}`)];
        names[Math.min(focusIndex, names.length - 1)]?.focus();
    };
    const header = createElement(document, "div", "input-map-header");
    header.append(
        createElement(document, "span", "input-map-path", inputMap.path),
        createButton(document, {className: "", text: "Add Action", title: "Add an action to the input map", onClick: () => {
            structural(current => withNewAction(current), draft().actions.length);
        }}),
    );
    element.append(header);
    const rows = new Map<number, HTMLElement>();
    const actions = draft().actions;
    if (actions.length === 0) element.append(createElement(document, "p", "settings-form-hint", NO_ACTIONS_TEXT));
    actions.forEach((action, index) => {
        const row = createElement(document, "div", "input-map-action");
        const nameInput = textInput(document, action.name, value => model.setInputMapDraft(withActionRenamed(draft(), index, value)));
        nameInput.classList.add(ACTION_NAME_CLASS);
        nameInput.setAttribute("aria-label", `Action ${index + 1} name`);
        const bindings = createElement(document, "div", "input-map-bindings");
        action.bindings.forEach((binding, bindingIndex) => {
            const chip = createElement(document, "span", "input-map-binding");
            chip.append(
                createElement(document, "span", "", bindingText(binding)),
                createButton(document, {className: "string-list-remove", text: "×", title: `Remove ${bindingText(binding)} from ${action.name}`, onClick: () => structural(current => withoutBinding(current, index, bindingIndex), index)}),
            );
            bindings.append(chip);
        });
        const controls = createElement(document, "div", "input-map-controls");
        const keyOfEvent = context.keyOfEvent;
        if (keyOfEvent !== undefined) {
            const listen = createButton(document, {className: "", text: LISTEN_TEXT, title: "Press the key or chord to bind", onClick: () => {
                if (keyListener.listeningTo(index)) {
                    keyListener.cancel();
                    listen.textContent = LISTEN_TEXT;
                    return;
                }
                listen.textContent = LISTENING_TEXT;
                keyListener.start(index, element, keyOfEvent, binding => structural(current => withBinding(current, index, binding), index), () => {
                    listen.textContent = UNNAMED_KEY_TEXT;
                });
            }});
            controls.append(listen);
        }
        controls.append(
            selectOf(document, [{value: NO_CHOICE, label: ADD_KEY_TEXT}, ...INPUT_KEY_NAMES.map(key => ({value: key, label: key}))], NO_CHOICE, key => {
                if (key !== NO_CHOICE) structural(current => withBinding(current, index, {kind: "key", key}), index);
            }),
            selectOf(document, [{value: NO_CHOICE, label: ADD_BUTTON_TEXT}, ...INPUT_BUTTON_NAMES.map(button => ({value: button, label: button}))], NO_CHOICE, button => {
                if (button !== NO_CHOICE) structural(current => withBinding(current, index, {kind: "button", button}), index);
            }),
            createButton(document, {className: "", text: "↑", title: "Move up", onClick: () => structural(current => withActionMoved(current, index, MOVE_UP), Math.max(index + MOVE_UP, 0))}),
            createButton(document, {className: "", text: "↓", title: "Move down", onClick: () => structural(current => withActionMoved(current, index, MOVE_DOWN), index + MOVE_DOWN)}),
            createButton(document, {className: "", text: "Delete", title: `Delete the action ${action.name}`, onClick: () => structural(current => withoutAction(current, index), index)}),
        );
        const problems = createElement(document, "div", "settings-form-problems");
        rows.set(index, problems);
        row.append(nameInput, bindings, controls, problems);
        element.append(row);
    });
    return {
        element,
        showState: () => {
            const problems = model.inputMapProblems();
            for (const [index, slot] of rows) showProblems(slot, problems.get(index));
        },
    };
}

