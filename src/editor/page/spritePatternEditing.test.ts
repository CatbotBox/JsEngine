import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import {Sprite} from "../../engine/rendering/2d/sprite";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorFieldValue, StructFieldDescription} from "../editorProtocol";
import {ask, disposeEditorWorlds, editorWorld, fieldsOf} from "../world/editorServiceTestHarness";
import type {Harnessed} from "../world/editorServiceTestHarness";
import {structMemberOf, withListItem, withStructMember} from "./compoundValues";
import {entityTemplateRequest, SPRITE_TEMPLATE_SIZE} from "./entityTemplates";
import {areEditableInlineValues, isEditableInlineValue} from "./fieldValueText";
import type {ProjectFileOperations} from "./fileUndo";
import {EntityRefs, FieldsCommand, HOLDS_NO_ENTITIES, UndoStack} from "./undoStack";

const UNUSED_FILES = {} as ProjectFileOperations;
const WHITE = "#ffffff";
const RED = "#ff0000";
const RED_PIXEL = [255, 0, 0, 255];
const RGBA_BYTES = 4;
const EDITED_ROWS = ["##", "#"];
const TEMPLATE_ROWS = Array.from({length: SPRITE_TEMPLATE_SIZE}, () => "#".repeat(SPRITE_TEMPLATE_SIZE));
const TEMPLATE_PATTERN = {rows: TEMPLATE_ROWS, palette: [{char: "#", rgb: WHITE}]};
const PATTERN_FORM: StructFieldDescription = {
    kind: "struct",
    typeName: "SpritePattern",
    fields: [
        {key: "rows", kind: "textLines"},
        {
            key: "palette",
            kind: "list",
            element: {kind: "struct", typeName: "SpritePatternColor", fields: [{key: "char", kind: "string", nullable: false}, {key: "rgb", kind: "rgb"}]},
            elementDefault: {char: "#", rgb: WHITE},
        },
    ],
};

afterEach(() => disposeEditorWorlds());

async function createSprite(harnessed: Harnessed): Promise<Entity> {
    const {components} = await ask(harnessed, {op: "describeSchemas"});
    const knownTypeNames = new Set(components.map(schema => schema.typeName));
    return (await ask(harnessed, entityTemplateRequest("sprite", {knownTypeNames, perspective: false}))).entity;
}

async function shownImage(harnessed: Harnessed, entity: Entity): Promise<unknown> {
    return fieldsOf(await ask(harnessed, {op: "getEntity", entity}), "Sprite")?.image;
}

function imageSize(harnessed: Harnessed, entity: Entity): (number | undefined)[] {
    const image = harnessed.world.entityManager.getComponent<Sprite>(entity, Sprite)?.image;
    return [image?.sizeX, image?.sizeY];
}

describe("inline sprite pattern editing", () => {
    test("Sprite.image describes its inline pattern as an editable struct of rows and a palette of colours", async () => {
        const harnessed = editorWorld();
        const {components} = await ask(harnessed, {op: "describeSchemas"});
        const image = components.find(schema => schema.typeName === "Sprite")?.fields.find(field => field.key === "image");
        expect(image).toEqual({key: "image", kind: "asset", assetType: "spriteImage", editableStruct: PATTERN_FORM});
    });

    test("only values holding every member of the editable struct are shown as the inline form", () => {
        const values: EditorFieldValue[] = [TEMPLATE_PATTERN, {rows: ["#"], palette: []}];
        expect(areEditableInlineValues(values, PATTERN_FORM)).toBe(true);
        expect(areEditableInlineValues([...values, {path: "sprites/ship.png"}], PATTERN_FORM)).toBe(false);
        expect(areEditableInlineValues([], PATTERN_FORM)).toBe(false);
        expect(isEditableInlineValue({inline: {width: 2, height: 2}}, PATTERN_FORM)).toBe(false);
        expect(isEditableInlineValue({rows: ["#"]}, PATTERN_FORM)).toBe(false);
        expect(isEditableInlineValue(null, PATTERN_FORM)).toBe(false);
        expect(isEditableInlineValue({}, {kind: "struct", fields: []})).toBe(false);
    });

    test("a member edit sends a new inline pattern that rebuilds the image, and undo and redo restore each value like any field edit", async () => {
        const harnessed = editorWorld();
        const entity = await createSprite(harnessed);
        expect(await shownImage(harnessed, entity)).toEqual(TEMPLATE_PATTERN);
        expect(imageSize(harnessed, entity)).toEqual([SPRITE_TEMPLATE_SIZE, SPRITE_TEMPLATE_SIZE]);
        const refs = new EntityRefs();
        const stack = new UndoStack({client: harnessed.client, refs, files: UNUSED_FILES});
        const edit = async (before: SceneJsonValue, after: SceneJsonValue): Promise<EditorFieldValue> => {
            const {value} = await ask(harnessed, {op: "setField", entity, typeName: "Sprite", key: "image", value: after});
            stack.push(FieldsCommand.record(refs, "Edit Sprite.image", [{entity, typeName: "Sprite", key: "image", before, after, entityShape: HOLDS_NO_ENTITIES}]));
            return value;
        };

        const reshaped = withStructMember(TEMPLATE_PATTERN, "rows", EDITED_ROWS);
        expect(await edit(TEMPLATE_PATTERN, reshaped)).toEqual(reshaped);
        expect(imageSize(harnessed, entity)).toEqual([EDITED_ROWS[0].length, EDITED_ROWS.length]);
        const recoloured = withStructMember(reshaped, "palette", withListItem(structMemberOf(reshaped, "palette"), 0, {char: "#", rgb: RED}));
        await edit(reshaped, recoloured);
        const image = harnessed.world.entityManager.getComponent<Sprite>(entity, Sprite)!.image!;
        expect(Array.from(image.rgba.subarray(0, RGBA_BYTES))).toEqual(RED_PIXEL);

        await stack.undo();
        expect(await shownImage(harnessed, entity)).toEqual(reshaped);
        await stack.undo();
        expect(await shownImage(harnessed, entity)).toEqual(TEMPLATE_PATTERN);
        expect(imageSize(harnessed, entity)).toEqual([SPRITE_TEMPLATE_SIZE, SPRITE_TEMPLATE_SIZE]);
        await stack.redo();
        expect(await shownImage(harnessed, entity)).toEqual(reshaped);
        const {sceneText} = await ask(harnessed, {op: "saveScene"});
        expect(sceneText.includes(JSON.stringify(EDITED_ROWS[0]))).toBe(true);
    });

    test("one edit of several sprites gives them one shared image, and stopping play restores the pattern edited during play", async () => {
        const harnessed = editorWorld();
        const first = await createSprite(harnessed);
        const second = await createSprite(harnessed);
        const reshaped = withStructMember(TEMPLATE_PATTERN, "rows", EDITED_ROWS);
        await ask(harnessed, {op: "setFields", edits: [first, second].map(entity => ({entity, typeName: "Sprite", key: "image", value: reshaped}))});
        const imageOf = (entity: Entity) => harnessed.world.entityManager.getComponent<Sprite>(entity, Sprite)!.image;
        expect(imageOf(second)).toBe(imageOf(first));

        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "setField", entity: first, typeName: "Sprite", key: "image", value: TEMPLATE_PATTERN});
        expect(imageSize(harnessed, first)).toEqual([SPRITE_TEMPLATE_SIZE, SPRITE_TEMPLATE_SIZE]);
        await ask(harnessed, {op: "setMode", mode: "edit"});
        expect(await shownImage(harnessed, first)).toEqual(reshaped);
        expect(imageSize(harnessed, first)).toEqual([EDITED_ROWS[0].length, EDITED_ROWS.length]);
    });
});
