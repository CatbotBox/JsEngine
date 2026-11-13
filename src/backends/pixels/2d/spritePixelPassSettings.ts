import {Component} from "../../../engine/core";
import type {SpritePixelRasterizerConfig} from "./spritePixelRasterizer";

export class SpritePixelPassSettings extends Component {
    public maxDepthFade: number = Number.POSITIVE_INFINITY;

    public toRasterizerConfig(): SpritePixelRasterizerConfig {
        return {maxDepthFade: this.maxDepthFade};
    }
}
