import {Component} from "../../../core";
import {SpriteRasterizerConfig} from "./spriteRasterizer";

const SIX_BITS_PER_CHANNEL = 0xFCFCFC;
const BLACK = 0x000000;

export class Console2DRenderSettings extends Component {
    public maxDepthFade: number = Number.POSITIVE_INFINITY;
    public colorQuantMask: number = SIX_BITS_PER_CHANNEL;
    public backgroundColor: number = BLACK;
    public halfBlockCells: boolean = true;

    public toRasterizerConfig(): SpriteRasterizerConfig {
        return {
            maxDepthFade: this.maxDepthFade,
            colorQuantMask: this.colorQuantMask,
            backgroundColor: this.backgroundColor,
            halfBlock: this.halfBlockCells,
        };
    }
}
