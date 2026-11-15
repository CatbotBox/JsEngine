import {Component} from "../../src/engine/core";
import {componentSchema} from "../../src/engine/scene/componentSchemaBuilder";
import {BRUTE, SWARMER} from "./tuning";
import type {EnemyKind} from "./tuning";

const NO_STEER_COS = 1;
const NO_STEER_SIN = 0;
const SWARM_CATEGORY = "Swarm";
const ENEMY_KINDS: readonly EnemyKind[] = [SWARMER, BRUTE];

function enemyKindNamed(name: string): EnemyKind {
    const kind = ENEMY_KINDS.find(candidate => candidate.name === name);
    if (kind === undefined) throw new Error(`Unknown enemy kind "${name}", expected one of ${ENEMY_KINDS.map(each => each.name).join(", ")}`);
    return kind;
}

export class Ship extends Component {
    public static readonly schema = componentSchema(Ship, "Ship").category(SWARM_CATEGORY).build();
}

export class Enemy extends Component {
    public static readonly schema = componentSchema(Enemy, "Enemy")
        .string("kindName").number("hitPoints").number("speedUnitsPerSecond").number("steerCos").number("steerSin")
        .category(SWARM_CATEGORY).build();

    public hitPoints: number;

    public constructor(
        public kind: EnemyKind = SWARMER,
        public speedUnitsPerSecond: number = kind.speedUnitsPerSecond,
        public steerCos: number = NO_STEER_COS,
        public steerSin: number = NO_STEER_SIN,
    ) {
        super();
        this.hitPoints = kind.hitPoints;
    }

    public get kindName(): string {
        return this.kind.name;
    }

    public set kindName(name: string) {
        this.kind = enemyKindNamed(name);
    }
}

export class Bullet extends Component {
    public static readonly schema = componentSchema(Bullet, "Bullet").number("remainingDamage").category(SWARM_CATEGORY).build();

    public constructor(public remainingDamage: number = 0) {
        super();
    }
}

export class Velocity extends Component {
    public static readonly schema = componentSchema(Velocity, "Velocity").number("xUnitsPerSecond").number("yUnitsPerSecond").category(SWARM_CATEGORY).build();

    public constructor(public xUnitsPerSecond: number = 0, public yUnitsPerSecond: number = 0) {
        super();
    }
}

export class Lifetime extends Component {
    public static readonly schema = componentSchema(Lifetime, "Lifetime").number("durationMs").number("remainingMs").category(SWARM_CATEGORY).build();

    public remainingMs: number;

    public constructor(public durationMs: number = 0) {
        super();
        this.remainingMs = durationMs;
    }
}

export class Spark extends Component {
    public static readonly schema = componentSchema(Spark, "Spark").category(SWARM_CATEGORY).build();
}

export const SWARM_COMPONENTS = [Ship, Enemy, Bullet, Velocity, Lifetime, Spark];
