import {Component, Entity} from "../core";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {ScreenSize} from "./screenSize";

export class Camera extends Component {
    setup(entity: Entity, entityManager: EntityWriteOptions) {
        entityManager.addComponent(entity, new ScreenSize())
    }
}