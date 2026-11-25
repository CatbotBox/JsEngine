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
            {op: "createEntity", name: "Camera", components: {Camera: {}, LocalPosition: {xyz: [0, 0, -10]}}},
            {op: "destroyEntity", entity: ENTITY},
            {op: "setEnabled", entity: ENTITY, enabled: false},
            {op: "saveScene"},
            {op: "loadScene", sceneText: "{}"},
            {op: "loadScene", sceneText: "{}", path: "scenes/main.scene.json"},
            {op: "loadScene", sceneText: "{}", path: "scenes/level.scene.json", additive: true},
            {op: "saveScene", scene: {id: 2, path: "scenes/level.scene.json"}},
            {op: "saveScene", scene: {id: 0, path: null}},
            {op: "unloadScene", sceneId: 2},
            {op: "setActiveScene", scene: {id: 2, path: null}},
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
            {op: "instantiateEntities", documentText: "{}", parent: null, scene: {id: 1, path: "scenes/main.scene.json"}},
            {op: "getPrefabOverrides", entity: ENTITY},
            {op: "revertPrefabInstance", entity: ENTITY},
            {op: "revertPrefabInstance", entity: ENTITY, paths: ["0/LocalPosition.xyz"]},
            {op: "applyPrefabInstance", entity: ENTITY},
            {op: "updatePrefabInstances", sourcePath: "a.prefab.json", documentText: "{}"},
            {op: "pickEntities", x: 1.5, y: -2, view: "scene"},
            {op: "setEditorCamera", view: "scene", position: [0, 1, 2], rotation: [0, 0, 0, 1]},
            {op: "setEditorCamera", view: "scene", position: [0, 1, 2], rotation: [0, 0, 0, 1], fieldOfViewDegrees: 60},
            {op: "getViewInfo", view: "scene"},
            {op: "getViewInfo", view: "game", entities: [ENTITY]},
            {op: "getViewInfo", view: "scene:2"},
            {op: "pickEntities", x: 0, y: 0, view: "scene:12"},
            {op: "setEditorCamera", view: "scene:3", position: [0, 1, 2], rotation: [0, 0, 0, 1]},
            {op: "exportSnapshot"},
            {op: "importSnapshot", documentText: "{}", mode: "edit"},
            {op: "importSnapshot", documentText: "{}", editSnapshotText: "{}", editSnapshotRecords: [0, -1], mode: "play", gameplayTicks: 4},
            {op: "describeAssetTypes"},
            {op: "getTickStats"},
            {op: "listSettings"},
            {op: "getResource", typeName: "SwarmTuning"},
            {op: "setResourceField", typeName: "SwarmTuning", key: "speed", value: 2},
            {op: "setResourceField", typeName: "SwarmTuning", key: "waves", value: [{count: 3}]},
            {op: "setResourceField", typeName: "SwarmTuning", key: "limit", value: null},
            {op: "reloadDataAsset", path: "data/swarm.tuning.asset.json"},
            {op: "reloadPrefab", path: "prefabs/enemy.prefab.json"},
            {op: "defaultResourceFields", typeName: "SwarmTuning"},
            {op: "getField", entity: ENTITY, typeName: "Sprite", key: "image"},
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
            {op: "createEntity", components: ["Camera"]},
            {op: "createEntity", components: {Camera: true}},
            {op: "setEnabled", entity: ENTITY, enabled: "yes"},
            {op: "loadScene", sceneText: {}},
            {op: "loadScene", sceneText: "{}", path: 7},
            {op: "loadScene", sceneText: "{}", additive: "yes"},
            {op: "saveScene", scene: {id: -1, path: null}},
            {op: "saveScene", scene: {id: 1}},
            {op: "unloadScene"},
            {op: "unloadScene", sceneId: 1.5},
            {op: "setActiveScene"},
            {op: "setActiveScene", scene: {id: 1, path: 3}},
            {op: "instantiateEntities", documentText: "{}", scene: 1},
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
            {op: "pickEntities", x: 0, y: 0, view: "scene:1"},
            {op: "getViewInfo", view: "game:2"},
            {op: "setEditorCamera", view: "game", position: [0, 1, 2], rotation: [0, 0, 0, 1]},
            {op: "setEditorCamera", position: [0, 1, 2], rotation: [0, 0, 0, 1]},
            {op: "setView", view: "game"},
            {op: "setEditorCamera", view: "scene", position: [0, 1], rotation: [0, 0, 0, 1]},
            {op: "setEditorCamera", view: "scene", position: [0, 1, 2], rotation: [0, 0, 0, Number.POSITIVE_INFINITY]},
            {op: "setEditorCamera", view: "scene", position: [0, 1, 2], rotation: [0, 0, 0, 1], fieldOfViewDegrees: 180},
            {op: "getViewInfo", view: "game", entities: ENTITY},
            {op: "importSnapshot", documentText: "{}"},
            {op: "importSnapshot", documentText: "{}", mode: "edit", editSnapshotRecords: [-2]},
            {op: "importSnapshot", documentText: "{}", mode: "edit", gameplayTicks: -1},
            {op: "getResource"},
            {op: "getResource", typeName: 3},
            {op: "setResourceField", typeName: "SwarmTuning", key: "speed"},
            {op: "setResourceField", typeName: "SwarmTuning", value: 2},
            {op: "setResourceField", key: "speed", value: 2},
            {op: "reloadDataAsset"},
            {op: "reloadDataAsset", path: 1},
            {op: "reloadPrefab"},
            {op: "reloadPrefab", path: 1},
            {op: "defaultResourceFields"},
            {op: "getField", entity: ENTITY, typeName: "Sprite"},
            {op: "getField", entity: ENTITY, key: "image"},
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
        expect(isEditorResponseMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: false, error: "no", stack: "    at f (a.ts:1:1)"})).toBe(true);
        expect(isEditorResponseMessage({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: false, error: "no", stack: 1})).toBe(false);
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
            {kind: "console", level: "error", text: "Error: boom", timeMs: 13, stack: "    at fail (game.js:1:2)"},
            {kind: "worldStopped", error: "boom"},
            {kind: "worldStopped", error: "boom", stack: "    at tick (game.js:3:4)"},
            {kind: "modeChanged", mode: "play", gameplayTicks: 3},
            {kind: "gameCameraChanged", present: false},
            {kind: "gameCameraChanged", present: true},
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
            {kind: "console", level: "error", text: "x", timeMs: 1, stack: 7},
            {kind: "console", level: "error", text: "x", timeMs: 1, stack: null},
            {kind: "worldStopped"},
            {kind: "worldStopped", error: "boom", stack: 3},
            {kind: "modeChanged", mode: "play", gameplayTicks: -1},
            {kind: "gameCameraChanged"},
            {kind: "gameCameraChanged", present: 0},
            {kind: "gameCameraChanged", present: "false"},
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
