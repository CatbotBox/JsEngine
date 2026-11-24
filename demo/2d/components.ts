import {Component, NULL_ENTITY} from "@jsengine/engine/core";
import type {Entity} from "@jsengine/engine/core";
import {WHITE_RGB} from "@jsengine/engine/rendering";
import type {Rgb} from "@jsengine/engine/scene";

const DEMO_2D_CATEGORY = "Demo 2D";

export class FadeToColor extends Component {
    public static readonly category = DEMO_2D_CATEGORY;

    public targetRgb: Rgb = WHITE_RGB;
    public durationMs = 0;
    public elapsedMs = 0;
}

export class OriginalColor extends Component {
    public static readonly category = DEMO_2D_CATEGORY;

    public rgb: Rgb = WHITE_RGB;
}

export class Player extends Component {
    public static readonly category = DEMO_2D_CATEGORY;
}

export class RandomizeTint extends Component {
    public static readonly category = DEMO_2D_CATEGORY;
}

export class Demo2dHud extends Component {
    public static readonly category = DEMO_2D_CATEGORY;

    public entityCounter: Entity = NULL_ENTITY;
    public fpsCounter: Entity = NULL_ENTITY;
}
