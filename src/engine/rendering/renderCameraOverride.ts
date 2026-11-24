import {NULL_ENTITY, Resource} from "../core";
import type {Component, ComponentCtor, Entity, EntityQuery, World} from "../core";
import {ComponentType} from "../core/componentType";
import {getOwner} from "../core/ownership";

export type RenderCameraSpec = Readonly<Record<string, ComponentCtor<Component>>>;
export type RenderCameraRow<S extends RenderCameraSpec> = {[K in keyof S]: InstanceType<S[K]>};
export type RenderCameraQuery = Pick<EntityQuery, "getSingleton" | "tryGetSingleton">;

export const RENDER_CAMERA_OVERRIDE_ERROR = "ERROR: THE RENDER CAMERA OVERRIDE IS NOT A LIVE CAMERA ENTITY";

export function cameraComponentsOf<S extends RenderCameraSpec>(world: World, camera: Entity, spec: S): RenderCameraRow<S> | undefined {
    const archetype = getOwner(world, camera);
    if (archetype === undefined) return undefined;
    const row = archetype.getIndexOfEntity(camera);
    if (row === undefined) return undefined;
    const components: Record<string, Component> = {};
    for (const key in spec) {
        const component = archetype.getColumn(ComponentType.of(spec[key]))?.get(row) as Component | undefined;
        if (component === undefined) return undefined;
        components[key] = component;
    }
    return components as RenderCameraRow<S>;
}

export class RenderCameraOverride extends Resource {
    public constructor(public camera: Entity) {
        super();
    }

    public componentsOf<S extends RenderCameraSpec>(world: World, spec: S): RenderCameraRow<S> | undefined {
        return cameraComponentsOf(world, this.camera, spec);
    }
}

export function renderCameraEntity(world: World, cameraQuery: RenderCameraQuery): Entity | undefined {
    const override = world.resources.tryGet(RenderCameraOverride);
    if (override !== undefined) return override.camera;
    return cameraQuery.tryGetSingleton({}, {includeEntity: true})?.entity;
}

export function renderCameraComponents<S extends RenderCameraSpec>(world: World, cameraQuery: RenderCameraQuery, spec: S): RenderCameraRow<S> | undefined {
    const override = world.resources.tryGet(RenderCameraOverride);
    if (override !== undefined) return override.componentsOf(world, spec);
    return cameraQuery.getSingleton(spec) as unknown as RenderCameraRow<S>;
}

export function renderTargetCamera(camera: Entity | undefined, cameraQuery: Pick<EntityQuery, "tryGetSingleton">): Entity | undefined {
    return camera ?? cameraQuery.tryGetSingleton({}, {includeEntity: true})?.entity;
}

export class RenderTargetCameras {
    private readonly lent = new RenderCameraOverride(NULL_ENTITY);
    private displaced: RenderCameraOverride | undefined;

    public lend(world: World, camera: Entity): void {
        const resources = world.resources;
        const present = resources.tryGet(RenderCameraOverride);
        if (present !== this.lent) {
            this.displaced = present;
            resources.insert(this.lent);
        }
        this.lent.camera = camera;
    }

    public release(world: World): void {
        const resources = world.resources;
        if (resources.tryGet(RenderCameraOverride) !== this.lent) return;
        const displaced = this.displaced;
        this.displaced = undefined;
        if (displaced === undefined) resources.remove(RenderCameraOverride);
        else resources.insert(displaced);
    }
}
