import {Component, NULL_ENTITY} from "@jsengine/engine/core";
import type {Entity} from "@jsengine/engine/core";
import {Vec3} from "@jsengine/engine/math";
import type {Int} from "@jsengine/engine/scene";

const DEMO_3D_CATEGORY = "Demo 3D";
const UNIT_SCALE = 1;

export class ModelGrid extends Component {
    public static readonly category = DEMO_3D_CATEGORY;

    public spacingUnits = 0;
    public rotationRad: Vec3 = Vec3.alloc();
    public scale: Vec3 = Vec3.alloc(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE);
    public selectedModelIndex: Int = 0;
}

export class ModelGridSlot extends Component {
    public static readonly category = DEMO_3D_CATEGORY;

    public slot: Int = 0;
}

export class Demo3dHud extends Component {
    public static readonly category = DEMO_3D_CATEGORY;

    public preview: Entity = NULL_ENTITY;
    public entityCounter: Entity = NULL_ENTITY;
    public fpsCounter: Entity = NULL_ENTITY;
}
