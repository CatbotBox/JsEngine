import type {RenderPassKind} from "./renderPasses";

export const RENDER_PASS_REQUIRED_TYPES: Readonly<Record<RenderPassKind, readonly string[]>> = {
    meshes: ["RenderMesh"],
    sprites: ["Sprite"],
    hudSprites: ["HudElement", "Sprite"],
    hudText: ["HudElement", "TextSprite"],
    worldText: ["TextSprite"],
    ui: ["UiRoot"],
};
