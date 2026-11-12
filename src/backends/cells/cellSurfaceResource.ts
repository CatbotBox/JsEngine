import {Resource} from "../../engine/core";
import type {World} from "../../engine/core";
import type {CellSurface} from "./cellSurface";

const MISSING_SURFACE = "This world has no CellSurfaceResource: the host must insert one "
    + "(world.resources.insert(new CellSurfaceResource(surface))) before cell systems are created";

export class CellSurfaceResource extends Resource {
    public constructor(public readonly surface: CellSurface) {
        super();
    }

    public static surfaceOf(world: World): CellSurface {
        const resource = world.resources.tryGet(CellSurfaceResource);
        if (resource === undefined) throw new Error(MISSING_SURFACE);
        return resource.surface;
    }
}
