import {NULL_ENTITY} from "../core/entity";
import {LocalPosition} from "../translation/localPosition";
import {LocalRotation} from "../translation/localRotation";
import {LocalScale} from "../translation/localScale";
import {LocalToWorld} from "../translation/localToWorld";
import {Parent, ParentTransform} from "../translation/parent";
import {Children} from "../translation/children";
import {Camera} from "../rendering/camera";
import {ScreenSize} from "../rendering/screenSize";
import {HudElement} from "../rendering/hudElement";
import {ScreenAnchor} from "../rendering/screenAnchor";
import {RenderBounds} from "../rendering/renderBounds";
import {RenderBoundsOffset} from "../rendering/renderBoundsOffset";
import {WorldSpaceRenderBounds} from "../rendering/worldSpaceRenderBounds";
import {TextSprite} from "../rendering/textSprite";
import {Sprite} from "../rendering/2d/sprite";
import {FieldOfView} from "../rendering/3d/fieldOfView";
import {RenderMesh} from "../rendering/3d/renderMesh";
import {FaceCulling} from "../rendering/3d/faceCulling";
import {AmbientLight} from "../rendering/3d/lighting/ambientLight";
import {DirectionalLight} from "../rendering/3d/lighting/directionalLight";
import {PointLight} from "../rendering/3d/lighting/pointLight";
import {componentSchema} from "./componentSchemaBuilder";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {PrefabInstance} from "./prefabInstance";
import {PARENT_COMPONENT_NAME, PARENT_ENTITY_KEY} from "./sceneSerialization";

const REQUIRED_ENTITY = {nullable: false};

export const ENGINE_COMPONENT_CATEGORIES = {
    transform: "Transform",
    camera: "Camera",
    rendering: "Rendering",
    rendering2d: "Rendering 2D",
    rendering3d: "Rendering 3D",
    hud: "HUD",
    lighting: "Lighting",
    prefab: "Prefab",
    settings: "Settings",
} as const;

const CATEGORY = ENGINE_COMPONENT_CATEGORIES;

export function registerEngineComponentSchemas(registry: ComponentSchemaRegistry): void {
    registry.register(componentSchema(LocalPosition, "LocalPosition").vec3("xyz").category(CATEGORY.transform).build());
    registry.register(componentSchema(LocalRotation, "LocalRotation").rotation("xyzw").category(CATEGORY.transform).build());
    registry.register(componentSchema(LocalScale, "LocalScale").vec3("xyz").category(CATEGORY.transform).build());
    registry.register(componentSchema(Parent, PARENT_COMPONENT_NAME).entity(PARENT_ENTITY_KEY, REQUIRED_ENTITY)
        .create(() => new Parent(NULL_ENTITY)).category(CATEGORY.transform).build());
    registry.register(componentSchema(Camera, "Camera").number("nearPlaneDistance").number("farPlaneDistance").category(CATEGORY.camera).build());
    registry.register(componentSchema(FieldOfView, "FieldOfView").number("radians").category(CATEGORY.camera).build());
    registry.register(componentSchema(Sprite, "Sprite").spriteImage("image").rgb("tint").number("opacity").category(CATEGORY.rendering2d).build());
    registry.register(componentSchema(RenderMesh, "RenderMesh").mesh("mesh").rgb("color").enum("faceCulling", {
        BackFaces: FaceCulling.BackFaces,
        FrontFaces: FaceCulling.FrontFaces,
        None: FaceCulling.None,
    }).category(CATEGORY.rendering3d).build());
    registry.register(componentSchema(TextSprite, "TextSprite")
        .textLines("image").nullableString("transparentChar").textColor("foreground").textColor("background").category(CATEGORY.rendering2d).build());
    registry.register(componentSchema(RenderBoundsOffset, "RenderBoundsOffset").number("x").number("y").number("z").category(CATEGORY.rendering).build());
    registry.register(componentSchema(ScreenAnchor, "ScreenAnchor").enum("anchorPosition", {
        "top-left": "top-left",
        "top-center": "top-center",
        "top-right": "top-right",
        "middle-left": "middle-left",
        "middle-center": "middle-center",
        "middle-right": "middle-right",
        "bottom-left": "bottom-left",
        "bottom-center": "bottom-center",
        "bottom-right": "bottom-right",
    }).category(CATEGORY.hud).build());
    registry.register(componentSchema(HudElement, "HudElement").category(CATEGORY.hud).build());
    registry.register(componentSchema(DirectionalLight, "DirectionalLight").rgb("color").number("intensity").category(CATEGORY.lighting).build());
    registry.register(componentSchema(PointLight, "PointLight").number("range").rgb("color").number("intensity").category(CATEGORY.lighting).build());
    registry.register(componentSchema(AmbientLight, "AmbientLight").rgb("color").number("intensity").category(CATEGORY.lighting).build());
    registry.register(componentSchema(PrefabInstance, "PrefabInstance").string("sourcePath").textLines("overrides").category(CATEGORY.prefab).build());
    registry.register(componentSchema(LocalToWorld, "LocalToWorld").presenceOnly().category(CATEGORY.transform).build());
    registry.register(componentSchema(RenderBounds, "RenderBounds").presenceOnly().category(CATEGORY.rendering).build());
    registry.register(componentSchema(ParentTransform, "ParentTransform").implied().category(CATEGORY.transform).build());
    registry.register(componentSchema(Children, "Children").implied().category(CATEGORY.transform).build());
    registry.register(componentSchema(WorldSpaceRenderBounds, "WorldSpaceRenderBounds").implied().category(CATEGORY.rendering).build());
    registry.register(componentSchema(ScreenSize, "ScreenSize").implied().category(CATEGORY.camera).build());
}
