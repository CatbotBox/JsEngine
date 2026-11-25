import {Component} from "../core";
import type {Entity} from "../core";
import type {EntityWriteOptions} from "../core/entityWriteOptions";
import {UiRect} from "./uiRect";
import {UiState} from "./uiState";

export abstract class UiNodeComponent extends Component {
    public setup(entity: Entity, entityManager: EntityWriteOptions): void {
        entityManager.addComponents(entity, [new UiRect(), new UiState()]);
    }
}
