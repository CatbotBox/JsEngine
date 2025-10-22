import {Component, Entity} from "../core";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {ScreenSize} from "./screenSize";

export class Camera extends Component {
    private _nearPlaneDistance: number = 0.1;
    private _farPlaneDistance: number = 100;

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