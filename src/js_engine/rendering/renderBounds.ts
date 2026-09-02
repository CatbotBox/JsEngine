import {Entity} from "../core";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {AABBComponent} from "./aabbComponent";
import {WorldSpaceRenderBounds} from "./worldSpaceRenderBounds";

/** An entity's render bounds in local space, before its LocalToWorld is applied. */
export class RenderBounds extends AABBComponent {
    setup(entity: Entity, entityManager: EntityWriteOptions) {
        entityManager.addComponent(entity, new WorldSpaceRenderBounds());
    }
}
