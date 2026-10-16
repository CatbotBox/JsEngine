import {EntityCommandBuffer} from "../../src/js_engine/core";
import {HudElement} from "../../src/js_engine/rendering";
import {AnchorPosition, ConsoleImage, ConsoleImageAnchor} from "../../src/js_engine/rendering/console";

/**
 * Create a screen-anchored HUD label and return its (tracked) image, so the caller can keep
 * the handle and rewrite `.image` each frame.
 *
 * Both demos built this same entity by hand -- 2d at module scope, 3d inside a system's
 * onCreate -- so the shape is shared here while each demo keeps its own structure. This is
 * game code rather than engine code, which is why it lives under demo/ and not src/.
 */
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
    image.transparentChar = undefined; // HUD labels are opaque

    return image;
}
