import {Component, Entity} from "../../core";
import {EntityWriteOptions} from "../../core/entityWriteOptions";
import {RenderBounds} from "../renderBounds";
import {SpriteImage} from "./spriteImage";
import {WHITE_RGB, PACKED_RGB_MASK} from "../packedRgb";


export class Sprite extends Component {
    public opacity: number = 1;

    public constructor(private _image?: SpriteImage, private _tint: number = WHITE_RGB) {
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

    get tint(): number {
        return this._tint;
    }

    set tint(value: number) {
        this._tint = value & PACKED_RGB_MASK;
    }
}
