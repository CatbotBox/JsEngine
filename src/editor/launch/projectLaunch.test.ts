import {describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import type {SceneLoadReport} from "../../engine/scene/sceneSerialization";
import {entityRemapOf, reloadNotices} from "./projectRunner";
import {forgetRecentProject, MAX_RECENT_PROJECTS, readRecentProjects, RECENT_PROJECTS_KEY, rememberRecentProject} from "./recentProjects";
import type {KeyValueStorage} from "./recentProjects";
import {WorkerEditorEvents} from "./projectWorkerSession";
import {EDITOR_MESSAGE_TYPE} from "../editorProtocol";
import type {EditorEvent} from "../editorProtocol";

class MemoryStorage implements KeyValueStorage {
    public readonly values = new Map<string, string>();

    public getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    public setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

const EMPTY_REPORT: SceneLoadReport = {
    skippedComponentTypes: [],
    skippedResourceTypes: [],
    danglingEntityRefs: [],
    droppedComponents: [],
    changedSchemas: [],
};

function entities(...handles: number[]): Entity[] {
    return handles as unknown as Entity[];
}

describe("recent projects", () => {
    test("remembering puts the project first, without duplicates, capped", () => {
        const storage = new MemoryStorage();
        for (let index = 0; index < MAX_RECENT_PROJECTS + 2; index++) rememberRecentProject(storage, `/p${index}`, `P${index}`, index);
        rememberRecentProject(storage, "/p5", "Renamed", 100);
        const projects = readRecentProjects(storage);
        expect(projects.length).toBe(MAX_RECENT_PROJECTS);
        expect(projects[0]).toEqual({path: "/p5", name: "Renamed", openedAtMs: 100});
        expect(projects.filter(project => project.path === "/p5").length).toBe(1);
        expect(forgetRecentProject(storage, "/p5").some(project => project.path === "/p5")).toBe(false);
    });

    test("broken or missing storage reads as no projects and writes are ignored", () => {
        const broken = new MemoryStorage();
        broken.setItem(RECENT_PROJECTS_KEY, "{not json");
        expect(readRecentProjects(broken)).toEqual([]);
        broken.setItem(RECENT_PROJECTS_KEY, JSON.stringify([{path: "/ok", name: "Ok", openedAtMs: 1}, {path: 3}]));
        expect(readRecentProjects(broken)).toEqual([{path: "/ok", name: "Ok", openedAtMs: 1}]);
        expect(readRecentProjects(undefined)).toEqual([]);
        const throwing: KeyValueStorage = {
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("denied");
            },
        };
        expect(rememberRecentProject(throwing, "/a", "A", 1)).toEqual([{path: "/a", name: "A", openedAtMs: 1}]);
    });
});

describe("hot reload helpers", () => {
    test("the entity remap pairs exported and imported entities by position", () => {
        const remap = entityRemapOf(entities(10, 11, 12), entities(20, 21));
        expect([...remap]).toEqual([[10, 20], [11, 21]]);
    });

    test("report notices name changed schemas and everything that was dropped", () => {
        const notices = reloadNotices({
            ...EMPTY_REPORT,
            changedSchemas: [{typeName: "Enemy", addedKeys: ["armor"], removedKeys: ["speed"]}],
            skippedComponentTypes: [{typeName: "Loose", entityCount: 3}],
            skippedResourceTypes: ["Score"],
        }, 7);
        expect(notices).toEqual([
            {level: "info", text: "Reloaded the game code (7 entities carried over)"},
            {level: "warn", text: "Enemy changed: new fields armor start at their defaults; removed fields speed were dropped"},
            {level: "warn", text: "Loose was dropped from 3 entities: it has no registered schema in the new code"},
            {level: "warn", text: "Resource Score was reset: it has no registered schema in the new code"},
        ]);
        expect(reloadNotices(EMPTY_REPORT, 0).length).toBe(1);
    });

    test("editor events are buffered until the first listener subscribes", () => {
        let deliver: (event: {readonly data: unknown}) => void = () => undefined;
        const events = new WorkerEditorEvents({addEventListener: (_type, listener) => deliver = listener});
        const first: EditorEvent = {kind: "worldStopped", error: "boom"};
        deliver({data: {type: EDITOR_MESSAGE_TYPE, event: first}});
        deliver({data: {type: "status", text: "not an editor event"}});
        const received: EditorEvent[] = [];
        events.onEvent(event => received.push(event));
        const second: EditorEvent = {kind: "modeChanged", mode: "play", gameplayTicks: 1, view: "game"};
        deliver({data: {type: EDITOR_MESSAGE_TYPE, event: second}});
        expect(received).toEqual([first, second]);
    });
});
