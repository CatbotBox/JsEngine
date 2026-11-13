import {Resource} from "../../engine/core";
import type {World} from "../../engine/core";
import type {PixelPresenter} from "./pixelPresenter";

const MISSING_PRESENTER = "This world has no PixelPresenterResource: the host must insert one "
    + "(world.resources.insert(new PixelPresenterResource(presenter))) before pixel systems are created";

export class PixelPresenterResource extends Resource {
    public constructor(public readonly presenter: PixelPresenter) {
        super();
    }

    public static presenterOf(world: World): PixelPresenter {
        const resource = world.resources.tryGet(PixelPresenterResource);
        if (resource === undefined) throw new Error(MISSING_PRESENTER);
        return resource.presenter;
    }
}
