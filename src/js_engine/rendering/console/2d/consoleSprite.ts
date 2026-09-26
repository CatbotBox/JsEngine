import {Component, Entity} from "../../../core";
import {EntityWriteOptions} from "../../../core/entityWriteOptions";
import {RenderBounds} from "../../renderBounds";
import {SpriteImage} from "./spriteImage";

/**
 * A pixel-based 2D sprite, drawn by ConsoleSpriteRenderPassSystem through the
 * same packed-RGB half-block cells as the 3D pass — colors all the way to
 * flush, no ANSI text per pixel (see ConsoleImage for that legacy path).
 *
 * The component only carries per-entity looks; the pixels live in an immutable
 * shared {@link SpriteImage}, mirroring RenderMesh → Mesh. To change what a
 * sprite shows, assign a different image.
 *
 * One sprite pixel is one terminal cell wide and half a cell tall (cells are
 * ~2:1), so pixels render square: an 8x8 image covers 8 cells x 4 cells.
 */
export class ConsoleSprite extends Component {
    /** 0..1 multiplied onto every pixel's alpha; translucent pixels blend toward the settings' backgroundColor. */
    public opacity: number = 1;

    public constructor(private _image?: SpriteImage, private _tint: number = 0xFFFFFF) {
        super();
    }

    public setup(entity: Entity, entityManager: EntityWriteOptions) {
        entityManager.addComponent(entity, new RenderBounds());
    }

    get image(): SpriteImage | undefined {
        return this._image;
    }

    set image(value: SpriteImage | undefined) {
        this._image = value;
    }

    /** Packed 0xRRGGBB multiplied onto every pixel; 0xFFFFFF leaves pixels untouched. Cheap to animate — no pixel rebuild. */
    get tint(): number {
        return this._tint;
    }

    set tint(value: number) {
        this._tint = value & 0xFFFFFF;
    }
}
