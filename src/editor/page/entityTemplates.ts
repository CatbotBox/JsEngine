import type {SceneJsonObject} from "../../engine/scene";
import {UNIT_CUBE_MESH_PATH} from "../../engine/scene/fieldSchema";
import type {CreateEntityRequest, EditorComponentValues, EditorEntitySummary} from "../editorProtocol";
import {AXIS_X, degreesToRadians, quaternionFromAxisAngle} from "./editorCameraMath";
import type {Quaternion} from "./editorCameraMath";

export type EntityTemplate = "camera" | "sprite" | "text" | "mesh" | "directionalLight" | "pointLight" | "ambientLight";

export interface EntityTemplateContext {
    readonly knownTypeNames: ReadonlySet<string>;
    readonly perspective: boolean;
}

export const ENTITY_TEMPLATES: readonly EntityTemplate[] = ["camera", "sprite", "text", "mesh", "directionalLight", "pointLight", "ambientLight"];
export const ENTITY_TEMPLATE_NAMES: Readonly<Record<EntityTemplate, string>> = {
    camera: "Camera",
    sprite: "Sprite",
    text: "Text",
    mesh: "Mesh",
    directionalLight: "Directional Light",
    pointLight: "Point Light",
    ambientLight: "Ambient Light",
};
export const PERSPECTIVE_CAMERA_DISTANCE = 10;
export const SPRITE_TEMPLATE_SIZE = 4;
export const TEXT_TEMPLATE_LINE = "Text";
export const DIRECTIONAL_LIGHT_PITCH_DEGREES = 50;

const CAMERA = "Camera";
const FIELD_OF_VIEW = "FieldOfView";
const LOCAL_POSITION = "LocalPosition";
const LOCAL_ROTATION = "LocalRotation";
const LOCAL_SCALE = "LocalScale";
const SPRITE = "Sprite";
const SPRITE_PATTERN = "SpritePattern";
const TEXT_SPRITE = "TextSprite";
const RENDER_MESH = "RenderMesh";
const DIRECTIONAL_LIGHT = "DirectionalLight";
const POINT_LIGHT = "PointLight";
const AMBIENT_LIGHT = "AmbientLight";
const WHITE = "#ffffff";
const SPRITE_PATTERN_CHAR = "#";
const PERSPECTIVE_FIELD_OF_VIEW_DEGREES = 60;
const POINT_LIGHT_RANGE = 10;
const AMBIENT_LIGHT_INTENSITY = 0.2;
const FULL_INTENSITY = 1;
const IDENTITY_ROTATION: Quaternion = [0, 0, 0, 1];
const UNIT_SCALE = [1, 1, 1];
const ORIGIN = [0, 0, 0];

const REQUIRED_TYPE_NAMES: Readonly<Record<EntityTemplate, readonly string[]>> = {
    camera: [CAMERA],
    sprite: [SPRITE, SPRITE_PATTERN],
    text: [TEXT_SPRITE],
    mesh: [RENDER_MESH],
    directionalLight: [DIRECTIONAL_LIGHT],
    pointLight: [POINT_LIGHT],
    ambientLight: [AMBIENT_LIGHT],
};

function solidSpriteRows(): string[] {
    return Array.from({length: SPRITE_TEMPLATE_SIZE}, () => SPRITE_PATTERN_CHAR.repeat(SPRITE_TEMPLATE_SIZE));
}

function cameraComponents(context: EntityTemplateContext): EditorComponentValues {
    if (!context.perspective || !context.knownTypeNames.has(FIELD_OF_VIEW)) return {[LOCAL_POSITION]: {xyz: [...ORIGIN]}, [CAMERA]: {}};
    return {
        [LOCAL_POSITION]: {xyz: [0, 0, -PERSPECTIVE_CAMERA_DISTANCE]},
        [LOCAL_ROTATION]: {xyzw: [...IDENTITY_ROTATION]},
        [CAMERA]: {},
        [FIELD_OF_VIEW]: {radians: degreesToRadians(PERSPECTIVE_FIELD_OF_VIEW_DEGREES)},
    };
}

function templateComponents(template: EntityTemplate, context: EntityTemplateContext): EditorComponentValues {
    switch (template) {
        case "camera":
            return cameraComponents(context);
        case "sprite":
            return {
                [SPRITE]: {tint: WHITE, opacity: FULL_INTENSITY},
                [SPRITE_PATTERN]: {rows: solidSpriteRows(), palette: [{char: SPRITE_PATTERN_CHAR, rgb: WHITE}]},
            };
        case "text":
            return {[TEXT_SPRITE]: {image: [TEXT_TEMPLATE_LINE]}};
        case "mesh":
            return {
                [LOCAL_ROTATION]: {xyzw: [...IDENTITY_ROTATION]},
                [LOCAL_SCALE]: {xyz: [...UNIT_SCALE]},
                [RENDER_MESH]: {mesh: {path: UNIT_CUBE_MESH_PATH}, color: WHITE},
            };
        case "directionalLight":
            return {
                [LOCAL_ROTATION]: {xyzw: [...quaternionFromAxisAngle(AXIS_X, degreesToRadians(DIRECTIONAL_LIGHT_PITCH_DEGREES))]},
                [DIRECTIONAL_LIGHT]: {color: WHITE, intensity: FULL_INTENSITY},
            };
        case "pointLight":
            return {[POINT_LIGHT]: {range: POINT_LIGHT_RANGE, color: WHITE, intensity: FULL_INTENSITY}};
        case "ambientLight":
            return {[AMBIENT_LIGHT]: {color: WHITE, intensity: AMBIENT_LIGHT_INTENSITY}};
    }
}

function knownComponents(components: EditorComponentValues, knownTypeNames: ReadonlySet<string>): EditorComponentValues {
    const known: Record<string, SceneJsonObject> = {};
    for (const [typeName, values] of Object.entries(components)) if (knownTypeNames.has(typeName)) known[typeName] = values;
    return known;
}

export function entityTemplateProblem(template: EntityTemplate, knownTypeNames: ReadonlySet<string>): string | undefined {
    const missing = REQUIRED_TYPE_NAMES[template].filter(typeName => !knownTypeNames.has(typeName));
    if (missing.length === 0) return undefined;
    return `This game registers no ${missing.join(" or ")} component, so it cannot make a ${ENTITY_TEMPLATE_NAMES[template]}`;
}

export function entityTemplateRequest(template: EntityTemplate, context: EntityTemplateContext): CreateEntityRequest {
    return {op: "createEntity", name: ENTITY_TEMPLATE_NAMES[template], components: knownComponents(templateComponents(template, context), context.knownTypeNames)};
}

export function hasPerspectiveCamera(entities: readonly Pick<EditorEntitySummary, "componentTypeNames">[]): boolean {
    return entities.some(summary => summary.componentTypeNames.includes(CAMERA) && summary.componentTypeNames.includes(FIELD_OF_VIEW));
}
