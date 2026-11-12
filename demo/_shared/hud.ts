import {EntityCommandBuffer} from "../../src/js_engine/core";
import {HudElement} from "../../src/js_engine/rendering";
import {AnchorPosition, ConsoleImage, ConsoleImageAnchor} from "../../src/js_engine/rendering/console";

const OPAQUE: string | undefined = undefined;

export function createHudLabel(
    buffer: EntityCommandBuffer,
    name: string,
    text: string,
    anchorPosition: AnchorPosition,
): ConsoleImage {
    const anchor = new ConsoleImageAnchor();
    anchor.anchorPosition = anchorPosition;
    const entity = buffer.createEntity(name, [new HudElement(), anchor]);

    const image = buffer.addTrackedComponent(entity, new ConsoleImage());
    image.image = [text];
    image.transparentChar = OPAQUE;

    return image;
}
