import {Resource} from "../../engine/core";
import type {World} from "../../engine/core";
import type {CellPresenter} from "./cellPresenter";

const MISSING_PRESENTER = "This world has no CellPresenterResource: the host must insert one "
    + "(world.resources.insert(new CellPresenterResource(presenter))) before cell systems are created";

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
