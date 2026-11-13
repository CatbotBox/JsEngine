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

const REQUIRED_ENTITY = {nullable: false};

export function registerEngineComponentSchemas(registry: ComponentSchemaRegistry): void {
    registry.register(componentSchema(LocalPosition, "LocalPosition").vec3("xyz").build());
    registry.register(componentSchema(LocalRotation, "LocalRotation").rotation("xyzw").build());
    registry.register(componentSchema(LocalScale, "LocalScale").vec3("xyz").build());
    registry.register(componentSchema(Parent, "Parent").entity("entity", REQUIRED_ENTITY).create(() => new Parent(NULL_ENTITY)).build());
    registry.register(componentSchema(Camera, "Camera").number("nearPlaneDistance").number("farPlaneDistance").build());
    registry.register(componentSchema(FieldOfView, "FieldOfView").number("radians").build());
    registry.register(componentSchema(Sprite, "Sprite").spriteImage("image").rgb("tint").number("opacity").build());
    registry.register(componentSchema(RenderMesh, "RenderMesh").mesh("mesh").rgb("color").enum("faceCulling", {
        BackFaces: FaceCulling.BackFaces,
        FrontFaces: FaceCulling.FrontFaces,
        None: FaceCulling.None,
    }).build());
    registry.register(componentSchema(TextSprite, "TextSprite")
        .textLines("image").nullableString("transparentChar").textColor("foreground").textColor("background").build());
    registry.register(componentSchema(RenderBoundsOffset, "RenderBoundsOffset").number("x").number("y").number("z").build());
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
    }).build());
    registry.register(componentSchema(HudElement, "HudElement").build());
    registry.register(componentSchema(DirectionalLight, "DirectionalLight").rgb("color").number("intensity").build());
    registry.register(componentSchema(PointLight, "PointLight").number("range").rgb("color").number("intensity").build());
    registry.register(componentSchema(AmbientLight, "AmbientLight").rgb("color").number("intensity").build());
    registry.register(componentSchema(LocalToWorld, "LocalToWorld").presenceOnly().build());
    registry.register(componentSchema(RenderBounds, "RenderBounds").presenceOnly().build());
    registry.register(componentSchema(ParentTransform, "ParentTransform").implied().build());
    registry.register(componentSchema(Children, "Children").implied().build());
    registry.register(componentSchema(WorldSpaceRenderBounds, "WorldSpaceRenderBounds").implied().build());
    registry.register(componentSchema(ScreenSize, "ScreenSize").implied().build());
}
