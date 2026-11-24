import {Resource} from "@jsengine/engine/core";
import type {World} from "@jsengine/engine/core";
import type {ModelCatalog} from "./modelCatalog";
import type {PlacedModels} from "./placedModels";

const FIRST_PRESET = 0;

export class Demo3dSession extends Resource {
    public lightsOn = true;
    public lampOn = true;
    public renderPacingIndex = FIRST_PRESET;
    public selectionPrimed = false;

    public constructor(public readonly catalog: ModelCatalog, public readonly placedModels: PlacedModels) {
        super();
    }
}

export function sessionOf(world: World): Demo3dSession {
    return world.resources.get(Demo3dSession);
}
