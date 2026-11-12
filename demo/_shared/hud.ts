import {EntityCommandBuffer} from "../../src/engine/core";
import {HudElement} from "../../src/engine/rendering";
import {AnchorPosition, TextSprite, ScreenAnchor} from "../../src/engine/rendering";

const OPAQUE: string | undefined = undefined;

export function createHudLabel(
    buffer: EntityCommandBuffer,
    name: string,
    text: string,
    anchorPosition: AnchorPosition,
): TextSprite {
    const anchor = new ScreenAnchor();
    anchor.anchorPosition = anchorPosition;
    const entity = buffer.createEntity(name, [new HudElement(), anchor]);

    const image = buffer.addTrackedComponent(entity, new TextSprite());
    image.image = [text];
    image.transparentChar = OPAQUE;

    return image;
}
