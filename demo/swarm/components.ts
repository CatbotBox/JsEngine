import {Component} from "../../src/engine/core";
import {SWARMER} from "./tuning";
import type {EnemyKind} from "./tuning";

const NO_STEER_COS = 1;
const NO_STEER_SIN = 0;

export class Ship extends Component {
}

export class Enemy extends Component {
    public hitPoints: number;

    public constructor(
        public readonly kind: EnemyKind = SWARMER,
        public readonly speedUnitsPerSecond: number = kind.speedUnitsPerSecond,
        public readonly steerCos: number = NO_STEER_COS,
        public readonly steerSin: number = NO_STEER_SIN,
    ) {
        super();
        this.hitPoints = kind.hitPoints;
    }
}

export class Bullet extends Component {
    public constructor(public remainingDamage: number = 0) {
        super();
    }
}

export class Velocity extends Component {
    public constructor(public xUnitsPerSecond: number = 0, public yUnitsPerSecond: number = 0) {
        super();
    }
}

export class Lifetime extends Component {
    public remainingMs: number;

    public constructor(public readonly durationMs: number = 0) {
        super();
        this.remainingMs = durationMs;
    }
}

export class Spark extends Component {
}
