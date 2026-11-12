import {Component, Entity} from "../../core";
import {EntityWriteOptions} from "../../core/entityWriteOptions";
import {RenderBounds} from "../renderBounds";
import {SpriteImage} from "./spriteImage";

const WHITE = 0xFFFFFF;
const PACKED_RGB_MASK = 0xFFFFFF;

export class Sprite extends Component {
    public opacity: number = 1;

    public constructor(private _image?: SpriteImage, private _tint: number = WHITE) {
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
