import {Component} from "../../../engine/core";
import {SpriteCellRasterizerConfig} from "./spriteCellRasterizer";
import {BLACK_RGB, SIX_BITS_PER_CHANNEL_MASK} from "../../../engine/rendering/packedRgb";


export class TextSpriteCellPassSettings extends Component {
    public maxDepthFade: number = Number.POSITIVE_INFINITY;
    public colorQuantMask: number = SIX_BITS_PER_CHANNEL_MASK;
    public backgroundColor: number = BLACK_RGB;
    public halfBlockCells: boolean = true;

    public toRasterizerConfig(): SpriteCellRasterizerConfig {
        return {
            maxDepthFade: this.maxDepthFade,
            colorQuantMask: this.colorQuantMask,
            backgroundColor: this.backgroundColor,
            halfBlock: this.halfBlockCells,
        };
    }
}
