import {describe, expect, test} from "../engine/testing/harness";
import {
    EDITOR_MESSAGE_TYPE,
    ENTITY_HANDLE_LIMIT,
    isEditorEventMessage,
    isEditorRequest,
    isEditorRequestMessage,
    isEditorResponseMessage,
    requestIdOfMalformedEditorRequest,
} from "./editorProtocol";

const REQUEST_ID = 7;
const ENTITY = 1048577;

function message(request: unknown): unknown {
    return {type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, request};
}

describe("editor protocol guards", () => {
    test("every well-formed request passes", () => {
        const requests: unknown[] = [
            {op: "describeSchemas"},
            {op: "listEntities"},
            {op: "getEntity", entity: ENTITY},
            {op: "setField", entity: ENTITY, typeName: "LocalPosition", key: "xyz", value: [1, 2, 3]},
            {op: "setField", entity: ENTITY, typeName: "TextSprite", key: "transparentChar", value: null},
            {op: "addComponent", entity: ENTITY, typeName: "Camera"},
            {op: "addComponent", entity: ENTITY, typeName: "Parent", values: {entity: ENTITY}},
            {op: "removeComponent", entity: ENTITY, typeName: "Camera"},
            {op: "createEntity"},
            {op: "createEntity", name: "box", parent: ENTITY},
            {op: "destroyEntity", entity: ENTITY},
            {op: "setEnabled", entity: ENTITY, enabled: false},
            {op: "saveScene"},
            {op: "loadScene", sceneText: "{}"},
            {op: "loadScene", sceneText: "{}", path: "scenes/main.scene.json"},
            {op: "setMode", mode: "edit"},
            {op: "setMode", mode: "play"},
            {op: "setMode", mode: "paused"},
            {op: "step"},
            {op: "renameEntity", entity: ENTITY, name: "box"},
            {op: "renameEntity", entity: ENTITY, name: null},
            {op: "setFields", edits: []},
            {op: "setFields", edits: [{entity: ENTITY, typeName: "LocalPosition", key: "xyz", value: [1, 2, 3]}]},
            {op: "setParent", entity: ENTITY, parent: null},
            {op: "setParent", entity: ENTITY, parent: ENTITY, siblingIndex: 0},
            {op: "duplicateEntities", entities: [ENTITY]},
            {op: "serializeEntities", entities: []},
            {op: "instantiateEntities", documentText: "{}"},
            {op: "instantiateEntities", documentText: "{}", parent: null, siblingIndex: 2, prefabSourcePath: "a.prefab.json"},
            {op: "getPrefabOverrides", entity: ENTITY},
            {op: "revertPrefabInstance", entity: ENTITY},
            {op: "revertPrefabInstance", entity: ENTITY, paths: ["0/LocalPosition.xyz"]},
            {op: "applyPrefabInstance", entity: ENTITY},
            {op: "updatePrefabInstances", sourcePath: "a.prefab.json", documentText: "{}"},
            {op: "pickEntities", x: 1.5, y: -2, view: "scene"},
            {op: "setView", view: "game"},
            {op: "setEditorCamera", position: [0, 1, 2], rotation: [0, 0, 0, 1]},
            {op: "setEditorCamera", position: [0, 1, 2], rotation: [0, 0, 0, 1], fieldOfViewDegrees: 60},
            {op: "getViewInfo", view: "scene"},
            {op: "getViewInfo", view: "game", entities: [ENTITY]},
            {op: "exportSnapshot"},
            {op: "importSnapshot", documentText: "{}", mode: "edit"},
            {op: "importSnapshot", documentText: "{}", editSnapshotText: "{}", editSnapshotRecords: [0, -1], mode: "play", gameplayTicks: 4},
        ];
        expect(requests.filter(request => !isEditorRequest(request))).toEqual([]);
        expect(requests.every(request => isEditorRequestMessage(message(request)))).toBe(true);
    });

    test("malformed requests fail", () => {
        const requests: unknown[] = [
            undefined,
            null,
            [],
            {},
            {op: "explode"},
            {op: "getEntity"},
            {op: "getEntity", entity: -1},
            {op: "getEntity", entity: 1.5},
            {op: "getEntity", entity: ENTITY_HANDLE_LIMIT},
            {op: "getEntity", entity: "1"},
            {op: "setField", entity: ENTITY, typeName: "LocalPosition", key: "xyz"},
            {op: "setField", entity: ENTITY, typeName: 3, key: "xyz", value: 1},
            {op: "addComponent", entity: ENTITY, typeName: "Parent", values: [ENTITY]},
            {op: "removeComponent", entity: ENTITY},
            {op: "createEntity", name: 5},
            {op: "createEntity", parent: "root"},
            {op: "setEnabled", entity: ENTITY, enabled: "yes"},
            {op: "loadScene", sceneText: {}},
            {op: "loadScene", sceneText: "{}", path: 7},
            {op: "setMode", mode: "stopped"},
            {op: "renameEntity", entity: ENTITY},
            {op: "renameEntity", entity: ENTITY, name: 3},
            {op: "setFields"},
            {op: "setFields", edits: [{entity: ENTITY, typeName: "LocalPosition", key: "xyz"}]},
            {op: "setParent", entity: ENTITY},
            {op: "setParent", entity: ENTITY, parent: null, siblingIndex: -1},
            {op: "setParent", entity: ENTITY, parent: null, siblingIndex: 0.5},
            {op: "duplicateEntities", entities: [ENTITY, "x"]},
            {op: "serializeEntities"},
            {op: "instantiateEntities"},
            {op: "instantiateEntities", documentText: "{}", parent: "root"},
            {op: "instantiateEntities", documentText: "{}", prefabSourcePath: 1},
            {op: "revertPrefabInstance", entity: ENTITY, paths: [1]},
            {op: "updatePrefabInstances", documentText: "{}"},
            {op: "pickEntities", x: Number.NaN, y: 0, view: "scene"},
            {op: "pickEntities", x: 0, y: 0, view: "top"},
            {op: "setView", view: "both"},
            {op: "setEditorCamera", position: [0, 1], rotation: [0, 0, 0, 1]},
            {op: "setEditorCamera", position: [0, 1, 2], rotation: [0, 0, 0, Number.POSITIVE_INFINITY]},
            {op: "setEditorCamera", position: [0, 1, 2], rotation: [0, 0, 0, 1], fieldOfViewDegrees: 180},
            {op: "getViewInfo", view: "game", entities: ENTITY},
            {op: "importSnapshot", documentText: "{}"},
            {op: "importSnapshot", documentText: "{}", mode: "edit", editSnapshotRecords: [-2]},
            {op: "importSnapshot", documentText: "{}", mode: "edit", gameplayTicks: -1},
        ];
        expect(requests.filter(request => isEditorRequest(request))).toEqual([]);
    });

    test("a request message needs the editor type, a whole request id and a valid request", () => {
        const valid = {op: "listEntities"};
        expect(isEditorRequestMessage(message(valid))).toBe(true);
        expect(isEditorRequestMessage({type: "init", requestId: REQUEST_ID, request: valid})).toBe(false);
        expect(isEditorRequestMessage({type: EDITOR_MESSAGE_TYPE, requestId: "7", request: valid})).toBe(false);
        expect(isEditorRequestMessage({type: EDITOR_MESSAGE_TYPE, requestId: 1.5, request: valid})).toBe(false);
        expect(isEditorRequestMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID})).toBe(false);
        expect(isEditorRequestMessage({type: "inputEvents", events: []})).toBe(false);
    });

    test("response messages are a result or an error, never both shapes mixed", () => {
        expect(isEditorResponseMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: true, result: {entities: []}})).toBe(true);
        expect(isEditorResponseMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: false, error: "no"})).toBe(true);
        expect(isEditorResponseMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: true})).toBe(false);
        expect(isEditorResponseMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: false})).toBe(false);
        expect(isEditorResponseMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: "true", result: 1})).toBe(false);
        expect(isEditorResponseMessage({type: "frame", requestId: REQUEST_ID, ok: true, result: 1})).toBe(false);
        expect(isEditorResponseMessage(message({op: "listEntities"}))).toBe(false);
        expect(isEditorRequestMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: true, result: {}})).toBe(false);
    });

    test("event messages carry a typed event and no request id, and are neither requests nor responses", () => {
        const events: unknown[] = [
            {kind: "console", level: "warn", text: "careful", timeMs: 12},
            {kind: "worldStopped", error: "boom"},
            {kind: "modeChanged", mode: "play", gameplayTicks: 3, view: "game"},
        ];
        for (const event of events) {
            const eventMessage = {type: EDITOR_MESSAGE_TYPE, event};
            expect(isEditorEventMessage(eventMessage)).toBe(true);
            expect(isEditorResponseMessage(eventMessage)).toBe(false);
            expect(isEditorRequestMessage(eventMessage)).toBe(false);
            expect(requestIdOfMalformedEditorRequest(eventMessage)).toBeUndefined();
        }
        const malformed: unknown[] = [
            {kind: "console", level: "trace", text: "x", timeMs: 1},
            {kind: "console", level: "log", text: 1, timeMs: 1},
            {kind: "worldStopped"},
            {kind: "modeChanged", mode: "play", gameplayTicks: 3},
            {kind: "explode"},
        ];
        expect(malformed.filter(event => isEditorEventMessage({type: EDITOR_MESSAGE_TYPE, event}))).toEqual([]);
        expect(isEditorEventMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, event: events[1]})).toBe(false);
        expect(isEditorEventMessage({type: "status", event: events[1]})).toBe(false);
    });

    test("only an editor message with a request id but no valid request counts as malformed", () => {
        expect(requestIdOfMalformedEditorRequest(message({op: "explode"}))).toBe(REQUEST_ID);
        expect(requestIdOfMalformedEditorRequest({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID})).toBe(REQUEST_ID);
        expect(requestIdOfMalformedEditorRequest(message({op: "step"}))).toBeUndefined();
        expect(requestIdOfMalformedEditorRequest({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: false, error: "no"})).toBeUndefined();
        expect(requestIdOfMalformedEditorRequest({type: EDITOR_MESSAGE_TYPE, request: {op: "explode"}})).toBeUndefined();
        expect(requestIdOfMalformedEditorRequest({type: "resize", requestId: REQUEST_ID})).toBeUndefined();
    });
});
