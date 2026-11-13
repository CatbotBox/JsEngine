import {describe, expect, test} from "../engine/testing/harness";
import {
    EDITOR_MESSAGE_TYPE,
    ENTITY_HANDLE_LIMIT,
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
            {op: "setMode", mode: "edit"},
            {op: "setMode", mode: "play"},
            {op: "setMode", mode: "paused"},
            {op: "step"},
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
            {op: "setMode", mode: "stopped"},
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

    test("only an editor message with a request id but no valid request counts as malformed", () => {
        expect(requestIdOfMalformedEditorRequest(message({op: "explode"}))).toBe(REQUEST_ID);
        expect(requestIdOfMalformedEditorRequest({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID})).toBe(REQUEST_ID);
        expect(requestIdOfMalformedEditorRequest(message({op: "step"}))).toBeUndefined();
        expect(requestIdOfMalformedEditorRequest({type: EDITOR_MESSAGE_TYPE, requestId: REQUEST_ID, ok: false, error: "no"})).toBeUndefined();
        expect(requestIdOfMalformedEditorRequest({type: EDITOR_MESSAGE_TYPE, request: {op: "explode"}})).toBeUndefined();
        expect(requestIdOfMalformedEditorRequest({type: "resize", requestId: REQUEST_ID})).toBeUndefined();
    });
});
