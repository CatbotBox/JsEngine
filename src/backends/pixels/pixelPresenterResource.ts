import {Resource} from "../../engine/core";
import type {Entity, World} from "../../engine/core";
import type {PixelPresenter} from "./pixelPresenter";

const MISSING_PRESENTER = "This world has no PixelPresenterResource: the host must insert one "
    + "(world.resources.insert(new PixelPresenterResource(presenter))) before pixel systems are created";
const NO_TARGETS: readonly PixelRenderTarget[] = [];

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

export interface PixelRenderTarget {
    readonly camera: Entity | undefined;
    readonly presenter: PixelPresenter;
}

export class PixelRenderTargets extends Resource {
    public constructor(public readonly targets: readonly PixelRenderTarget[] = NO_TARGETS) {
        super();
    }

    public static targetsOf(world: World): readonly PixelRenderTarget[] {
        return world.resources.tryGet(PixelRenderTargets)?.targets ?? NO_TARGETS;
    }
}
