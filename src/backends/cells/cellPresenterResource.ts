import {Resource} from "../../engine/core";
import type {Entity, World} from "../../engine/core";
import type {CellPresenter} from "./cellPresenter";

const MISSING_PRESENTER = "This world has no CellPresenterResource: the host must insert one "
    + "(world.resources.insert(new CellPresenterResource(presenter))) before cell systems are created";
const NO_TARGETS: readonly CellRenderTarget[] = [];

export class CellPresenterResource extends Resource {
    public constructor(public readonly presenter: CellPresenter) {
        super();
    }

    public static presenterOf(world: World): CellPresenter {
        const resource = world.resources.tryGet(CellPresenterResource);
        if (resource === undefined) throw new Error(MISSING_PRESENTER);
        return resource.presenter;
    }
}

export interface CellRenderTarget {
    readonly camera: Entity | undefined;
    readonly presenter: CellPresenter;
}

export class CellRenderTargets extends Resource {
    public constructor(public readonly targets: readonly CellRenderTarget[] = NO_TARGETS) {
        super();
    }

    public static targetsOf(world: World): readonly CellRenderTarget[] {
        return world.resources.tryGet(CellRenderTargets)?.targets ?? NO_TARGETS;
    }
}
