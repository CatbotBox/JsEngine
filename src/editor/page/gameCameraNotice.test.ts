import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import type {EditorEvent} from "../editorProtocol";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import type {EditorClient} from "./editorClient";
import type {EditorEventSource, EditorSession} from "./editorSession";
import {EditorWorkspace} from "./editorWorkspace";
import {GameCameraNotice, NO_GAME_CAMERA_TEXT} from "./gameCameraNotice";

const PROJECT_NAME = "Notice fixture";
const NO_START_SCENE = null;
const NO_REMAP = new Map();

interface FakeElement {
    className: string;
    textContent: string | null;
    hidden: boolean;
    readonly children: FakeElement[];
    readonly attributes: Map<string, string>;
    setAttribute(name: string, value: string): void;
    append(...children: FakeElement[]): void;
}

function fakeElement(): FakeElement {
    const element: FakeElement = {
        className: "",
        textContent: null,
        hidden: false,
        children: [],
        attributes: new Map(),
        setAttribute: (name, value) => void element.attributes.set(name, value),
        append: (...children) => void element.children.push(...children),
    };
    return element;
}

function pageDocument(): Document {
    const stored = new Map<string, string>();
    const localStorage = {getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value)};
    return {
        defaultView: {localStorage},
        createElement: () => fakeElement(),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    } as unknown as Document;
}

class ScriptedEvents implements EditorEventSource {
    private readonly listeners = new Set<(event: EditorEvent) => void>();
    private buffered: EditorEvent[] | undefined = [];

    public onEvent(listener: (event: EditorEvent) => void): () => void {
        this.listeners.add(listener);
        const buffered = this.buffered;
        this.buffered = undefined;
        if (buffered !== undefined) for (const event of buffered) listener(event);
        return () => void this.listeners.delete(listener);
    }

    public send(event: EditorEvent): void {
        if (this.buffered !== undefined) {
            this.buffered.push(event);
            return;
        }
        for (const listener of [...this.listeners]) listener(event);
    }
}

function session(events: ScriptedEvents): EditorSession {
    const client = {request: () => new Promise(() => undefined), close: () => undefined} as unknown as EditorClient;
    return {client, events, files: {} as ProjectFileSystem, project: {name: PROJECT_NAME, startScene: NO_START_SCENE}};
}

const workspaces: EditorWorkspace[] = [];

afterEach(() => {
    for (const workspace of workspaces.splice(0)) workspace.stop();
});

function noticePage(events: ScriptedEvents = new ScriptedEvents()): {workspace: EditorWorkspace, notice: GameCameraNotice, element: FakeElement} {
    const document = pageDocument();
    const workspace = new EditorWorkspace(session(events), document);
    workspaces.push(workspace);
    const notice = new GameCameraNotice(document, workspace);
    return {workspace, notice, element: notice.element as unknown as FakeElement};
}

describe("game camera notice", () => {
    test("starts hidden and stays hidden through the events of a starting session until the world reports a missing camera", () => {
        const events = new ScriptedEvents();
        const {element} = noticePage(events);
        expect(element.hidden).toBe(true);
        expect(element.children.some(child => child.textContent === NO_GAME_CAMERA_TEXT)).toBe(true);
        events.send({kind: "console", level: "log", text: "loading", timeMs: 1});
        events.send({kind: "modeChanged", mode: "edit", gameplayTicks: 0});
        expect(element.hidden).toBe(true);
    });

    test("shows while the world reports no game camera and hides as soon as one exists", () => {
        const events = new ScriptedEvents();
        const {workspace, element} = noticePage(events);
        events.send({kind: "gameCameraChanged", present: false});
        expect(workspace.gameCameraMissing).toBe(true);
        expect(element.hidden).toBe(false);
        events.send({kind: "modeChanged", mode: "play", gameplayTicks: 1});
        expect(element.hidden).toBe(false);
        events.send({kind: "gameCameraChanged", present: true});
        expect(element.hidden).toBe(true);
    });

    test("a report buffered before the page subscribed still shows the notice", () => {
        const events = new ScriptedEvents();
        events.send({kind: "gameCameraChanged", present: false});
        const {element} = noticePage(events);
        expect(element.hidden).toBe(false);
    });

    test("a replaced session starts from a present camera unless its own buffered events say otherwise", () => {
        const {workspace, element} = noticePage();
        const first = workspace.session.events as ScriptedEvents;
        first.send({kind: "gameCameraChanged", present: false});
        expect(element.hidden).toBe(false);

        void workspace.replaceSession(session(new ScriptedEvents()), NO_REMAP);
        expect(element.hidden).toBe(true);

        const missing = new ScriptedEvents();
        missing.send({kind: "gameCameraChanged", present: false});
        void workspace.replaceSession(session(missing), NO_REMAP);
        expect(element.hidden).toBe(false);
        first.send({kind: "gameCameraChanged", present: true});
        expect(element.hidden).toBe(false);
    });
});
