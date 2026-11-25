import {NULL_ENTITY, Resource} from "@jsengine/engine/core";
import type {Entity, World} from "@jsengine/engine/core";
import type {ModelCatalog} from "./modelCatalog";
import type {PlacedModels} from "./placedModels";

const FIRST_PRESET = 0;
export const NO_SHOWCASE_LIGHT = -1;

export class Demo3dSession extends Resource {
    public lightsOn = true;
    public lampOn = true;
    public renderPacingIndex = FIRST_PRESET;
    public selectionPrimed = false;
    public showcaseLightIndex = NO_SHOWCASE_LIGHT;
    public showcaseLight: Entity = NULL_ENTITY;

    public constructor(public readonly catalog: ModelCatalog, public readonly placedModels: PlacedModels) {
        super();
    }
}

export function sessionOf(world: World): Demo3dSession {
    return world.resources.get(Demo3dSession);
}
