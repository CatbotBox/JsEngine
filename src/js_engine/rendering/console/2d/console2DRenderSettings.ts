import {Component} from "../../../core";
import {SpriteRasterizerConfig} from "./spriteRasterizer";

/**
 * Singleton configuration for ConsoleSpriteRenderPassSystem. The pass only runs
 * while exactly one entity carries this component; mutate the fields to retune
 * live. Mirrors Console3DRenderSettings for the features both pipelines share.
 */
export class Console2DRenderSettings extends Component {
    /**
     * Depth at which sprites have faded fully to black (linearly from the camera).
     * Infinity, the default, disables the fade.
     */
    public maxDepthFade: number = Number.POSITIVE_INFINITY;
    /**
     * Mask ANDed onto every packed color. Dropping the low 2 bits per channel
     * is visually indistinguishable in a terminal but makes adjacent cells
     * share colors far more often, which shortens the ANSI output. 0xFFFFFF keeps exact colors.
     */
    public colorQuantMask: number = 0xFCFCFC;
    /** Packed 0xRRGGBB that translucent pixels blend toward; match the terminal background. */
    public backgroundColor: number = 0x000000;
    /**
     * Two vertical pixels per cell drawn with the upper-half-block glyph (needs
     * a font with U+2580), doubling vertical resolution. Off, the two pixel rows
     * sharing a cell are averaged, so world-space sprite size stays identical.
     */
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
