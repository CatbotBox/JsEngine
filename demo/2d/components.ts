import {Component, NULL_ENTITY} from "../../src/engine/core";
import type {Entity} from "../../src/engine/core";
import {WHITE_RGB} from "../../src/engine/rendering";
import type {Rgb} from "../../src/engine/scene";

const DEMO_2D_CATEGORY = "Demo 2D";

export class FadeToColor extends Component {
    public static readonly category = DEMO_2D_CATEGORY;

    public rgb: Rgb = WHITE_RGB;
    public fadeTime = 0;
    public currentFadeTime = 0;
}

export class OriginalColor extends Component {
    public static readonly category = DEMO_2D_CATEGORY;

    public rgb: Rgb = WHITE_RGB;
}

export class PlayerTag extends Component {
    public static readonly category = DEMO_2D_CATEGORY;
}

export class RandomTint extends Component {
    public static readonly category = DEMO_2D_CATEGORY;
}

export class Demo2dHud extends Component {
    public static readonly category = DEMO_2D_CATEGORY;

    public entityCounter: Entity = NULL_ENTITY;
    public fpsCounter: Entity = NULL_ENTITY;
}
