import {Component, NULL_ENTITY} from "@jsengine/engine/core";
import type {Entity} from "@jsengine/engine/core";
import {WHITE_RGB} from "@jsengine/engine/rendering";
import type {Int, Rgb} from "@jsengine/engine/scene";

const SWARM_CATEGORY = "Swarm";
const NO_STEER_COS = 1;
const NO_STEER_SIN = 0;

export class Ship extends Component {
    public static readonly category = SWARM_CATEGORY;
}

export class Enemy extends Component {
    public static readonly category = SWARM_CATEGORY;

    public hitPoints: Int = 0;
    public radiusUnits = 0;
    public speedUnitsPerSecond = 0;
    public score: Int = 0;
    public woundedTint: Rgb = WHITE_RGB;
    public steerCos = NO_STEER_COS;
    public steerSin = NO_STEER_SIN;
}

export class Bullet extends Component {
    public static readonly category = SWARM_CATEGORY;

    public remainingDamage: Int = 0;
    public radiusUnits = 0;
}

export class Spark extends Component {
    public static readonly category = SWARM_CATEGORY;
}

export class SwarmHud extends Component {
    public static readonly category = SWARM_CATEGORY;

    public status: Entity = NULL_ENTITY;
    public stats: Entity = NULL_ENTITY;
    public banner: Entity = NULL_ENTITY;
}
