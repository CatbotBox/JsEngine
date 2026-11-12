import {Component, Entity} from "../core";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {ScreenSize} from "./screenSize";

const DEFAULT_NEAR_PLANE_DISTANCE = 0.1;
const DEFAULT_FAR_PLANE_DISTANCE = 100;

export class Camera extends Component {
    private _nearPlaneDistance: number = DEFAULT_NEAR_PLANE_DISTANCE;
    private _farPlaneDistance: number = DEFAULT_FAR_PLANE_DISTANCE;

    get nearPlaneDistance(): number {
        return this._nearPlaneDistance;
    }

    set nearPlaneDistance(value: number) {
        this._nearPlaneDistance = value;
    }

    get farPlaneDistance(): number {
        return this._farPlaneDistance;
    }

    set farPlaneDistance(value: number) {
        this._farPlaneDistance = value;
    }

    setup(entity: Entity, entityManager: EntityWriteOptions) {
        entityManager.addComponent(entity, new ScreenSize())
    }
}