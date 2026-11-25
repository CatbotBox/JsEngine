import {Component} from "../core";
import type {Entity} from "../core";
import type {EntityWriteOptions} from "../core/entityWriteOptions";
import {UiRect} from "./uiRect";

export abstract class UiNodeComponent extends Component {
    public setup(entity: Entity, entityManager: EntityWriteOptions): void {
        entityManager.addComponent(entity, new UiRect());
    }
}
