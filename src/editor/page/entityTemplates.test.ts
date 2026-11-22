import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {RenderMesh} from "../../engine/rendering/3d/renderMesh";
import {parseSceneDocument, UNIT_CUBE_MESH_PATH} from "../../engine/scene";
import {ask, disposeEditorWorlds, editorWorld, fieldsOf} from "../world/editorServiceTestHarness";
import {
    ENTITY_TEMPLATE_NAMES,
    ENTITY_TEMPLATES,
    entityTemplateProblem,
    entityTemplateRequest,
    hasPerspectiveCamera,
    PERSPECTIVE_CAMERA_DISTANCE,
    SPRITE_TEMPLATE_SIZE,
    TEXT_TEMPLATE_LINE,
} from "./entityTemplates";
import type {EntityTemplateContext} from "./entityTemplates";

const EVERY_TYPE = new Set([
    "Camera", "FieldOfView", "LocalPosition", "LocalRotation", "LocalScale", "Sprite", "SpritePattern", "TextSprite", "RenderMesh",
    "DirectionalLight", "PointLight", "AmbientLight",
]);
const FLAT: EntityTemplateContext = {knownTypeNames: EVERY_TYPE, perspective: false};
const PERSPECTIVE: EntityTemplateContext = {knownTypeNames: EVERY_TYPE, perspective: true};
const SPRITE_ROW = "#".repeat(SPRITE_TEMPLATE_SIZE);
const UNIT_CUBE_TRIANGLES = 12;

afterEach(() => disposeEditorWorlds());

describe("entity templates", () => {
    test("each template is one named createEntity request with its components", () => {
        for (const template of ENTITY_TEMPLATES) {
            const request = entityTemplateRequest(template, FLAT);
            expect([request.op, request.name, request.parent]).toEqual(["createEntity", ENTITY_TEMPLATE_NAMES[template], undefined]);
        }
        expect(Object.keys(entityTemplateRequest("camera", FLAT).components ?? {})).toEqual(["LocalPosition", "Camera"]);
        expect(entityTemplateRequest("sprite", FLAT).components?.SpritePattern).toEqual({rows: [SPRITE_ROW, SPRITE_ROW, SPRITE_ROW, SPRITE_ROW], palette: [{char: "#", rgb: "#ffffff"}]});
        expect(entityTemplateRequest("text", FLAT).components).toEqual({TextSprite: {image: [TEXT_TEMPLATE_LINE]}});
        expect(Object.keys(entityTemplateRequest("mesh", FLAT).components ?? {})).toEqual(["LocalRotation", "LocalScale", "RenderMesh"]);
        expect(entityTemplateRequest("mesh", FLAT).components?.RenderMesh.mesh).toEqual({path: UNIT_CUBE_MESH_PATH});
        expect(Object.keys(entityTemplateRequest("ambientLight", FLAT).components ?? {})).toEqual(["AmbientLight"]);
    });

    test("a camera matches the scene's cameras: perspective backs off along -z with a field of view", () => {
        const components = entityTemplateRequest("camera", PERSPECTIVE).components ?? {};
        expect(Object.keys(components)).toEqual(["LocalPosition", "LocalRotation", "Camera", "FieldOfView"]);
        expect(components.LocalPosition).toEqual({xyz: [0, 0, -PERSPECTIVE_CAMERA_DISTANCE]});
        expect(hasPerspectiveCamera([{componentTypeNames: ["Camera"]}, {componentTypeNames: ["FieldOfView"]}])).toBe(false);
        expect(hasPerspectiveCamera([{componentTypeNames: ["LocalPosition", "Camera", "FieldOfView"]}])).toBe(true);
    });

    test("optional components the game does not register are left out; missing required ones disable the template", () => {
        const flatGame = new Set(["Camera", "LocalPosition", "Sprite", "SpritePattern", "TextSprite"]);
        expect(Object.keys(entityTemplateRequest("camera", {knownTypeNames: flatGame, perspective: true}).components ?? {})).toEqual(["LocalPosition", "Camera"]);
        expect(entityTemplateProblem("sprite", flatGame)).toBeUndefined();
        expect(entityTemplateProblem("mesh", flatGame)).toBe("This game registers no RenderMesh component, so it cannot make a Mesh");
        expect(entityTemplateProblem("pointLight", flatGame)).toBe("This game registers no PointLight component, so it cannot make a Point Light");
    });

    test("the editor world accepts every template and fills the remaining fields with defaults", async () => {
        const harnessed = editorWorld();
        const {components} = await ask(harnessed, {op: "describeSchemas"});
        const knownTypeNames = new Set(components.map(schema => schema.typeName));
        for (const perspective of [false, true]) {
            for (const template of ENTITY_TEMPLATES) {
                expect(entityTemplateProblem(template, knownTypeNames)).toBeUndefined();
                const created = await ask(harnessed, entityTemplateRequest(template, {knownTypeNames, perspective}));
                expect(created.name).toBe(ENTITY_TEMPLATE_NAMES[template]);
            }
        }
        const text = await ask(harnessed, entityTemplateRequest("text", {knownTypeNames, perspective: false}));
        expect(fieldsOf(text, "TextSprite")?.image).toEqual([TEXT_TEMPLATE_LINE]);
    });

    test("a Mesh holds the built-in unit cube, which saves and reloads by its path without preloading a file", async () => {
        const harnessed = editorWorld();
        const {components} = await ask(harnessed, {op: "describeSchemas"});
        const knownTypeNames = new Set(components.map(schema => schema.typeName));
        const created = await ask(harnessed, entityTemplateRequest("mesh", {knownTypeNames, perspective: true}));
        expect(fieldsOf(created, "RenderMesh")?.mesh).toEqual({path: UNIT_CUBE_MESH_PATH});
        const mesh = harnessed.world.entityManager.getComponent<RenderMesh>(created.entity, RenderMesh)!.mesh;
        expect([mesh?.sourcePath, mesh?.triangleCount]).toEqual([UNIT_CUBE_MESH_PATH, UNIT_CUBE_TRIANGLES]);
        const {sceneText} = await ask(harnessed, {op: "saveScene"});
        const saved = parseSceneDocument(sceneText).entities.find(record => record.name === ENTITY_TEMPLATE_NAMES.mesh);
        expect(saved?.components.RenderMesh?.mesh).toEqual({path: UNIT_CUBE_MESH_PATH});
        await ask(harnessed, {op: "loadScene", sceneText});
        expect(harnessed.preloaded.flat()).toEqual([]);
        const reloaded = (await ask(harnessed, {op: "listEntities"})).entities.find(summary => summary.name === ENTITY_TEMPLATE_NAMES.mesh);
        const reloadedDetails = await ask(harnessed, {op: "getEntity", entity: reloaded!.entity});
        expect(fieldsOf(reloadedDetails, "RenderMesh")?.mesh).toEqual({path: UNIT_CUBE_MESH_PATH});
    });
});
