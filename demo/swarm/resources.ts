import {Resource} from "../../src/engine/core";
import {
    FALLBACK_ARENA_HEIGHT_UNITS,
    FALLBACK_ARENA_WIDTH_UNITS,
    FIRST_WAVE,
    START_BOMBS,
    START_INVULNERABILITY_MS,
    START_LIVES,
    WAVE_INTERMISSION_MS,
} from "./tuning";

const HALF = 0.5;

const MULBERRY32_INCREMENT = 0x6D2B79F5;
const MULBERRY32_FIRST_SHIFT = 15;
const MULBERRY32_SECOND_SHIFT = 7;
const MULBERRY32_THIRD_SHIFT = 14;
const MULBERRY32_ODD_MULTIPLIER = 61;
const LOWEST_BIT = 1;
const UINT32_RANGE = 2 ** 32;

export const SwarmPhase = {
    Title: "title",
    Starting: "starting",
    Playing: "playing",
    GameOver: "gameOver",
} as const;

export type SwarmPhase = typeof SwarmPhase[keyof typeof SwarmPhase];

export class SwarmState extends Resource {
    public phase: SwarmPhase = SwarmPhase.Title;
    public score = 0;
    public kills = 0;
    public wave = 0;
    public lives = 0;
    public bombs = 0;
    public invulnerableRemainingMs = 0;
    public fireCooldownMs = 0;
    public intermissionRemainingMs = 0;
    public waveEnemyTarget = 0;
    public waveEnemiesSpawned = 0;
    public spawnBudget = 0;
    public lastClearEarnedBomb = false;
    public shipX = 0;
    public shipY = 0;
    public arenaHalfWidthUnits = FALLBACK_ARENA_WIDTH_UNITS * HALF;
    public arenaHalfHeightUnits = FALLBACK_ARENA_HEIGHT_UNITS * HALF;

    public resetForNewGame(): void {
        this.phase = SwarmPhase.Playing;
        this.score = 0;
        this.kills = 0;
        this.wave = FIRST_WAVE;
        this.lives = START_LIVES;
        this.bombs = START_BOMBS;
        this.invulnerableRemainingMs = START_INVULNERABILITY_MS;
        this.fireCooldownMs = 0;
        this.intermissionRemainingMs = WAVE_INTERMISSION_MS;
        this.waveEnemyTarget = 0;
        this.waveEnemiesSpawned = 0;
        this.spawnBudget = 0;
        this.lastClearEarnedBomb = false;
        this.shipX = 0;
        this.shipY = 0;
    }
}

function unseededStart(): number {
    return Math.floor(Math.random() * UINT32_RANGE);
}

export class SeededRandom extends Resource {
    private state: number;

    public constructor(seed: number = unseededStart()) {
        super();
        this.state = seed >>> 0;
    }

    public next(): number {
        this.state = (this.state + MULBERRY32_INCREMENT) | 0;
        let mixed = this.state;
        mixed = Math.imul(mixed ^ (mixed >>> MULBERRY32_FIRST_SHIFT), mixed | LOWEST_BIT);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> MULBERRY32_SECOND_SHIFT), mixed | MULBERRY32_ODD_MULTIPLIER);
        return ((mixed ^ (mixed >>> MULBERRY32_THIRD_SHIFT)) >>> 0) / UINT32_RANGE;
    }

    public between(min: number, max: number): number {
        return min + (max - min) * this.next();
    }

    public indexBelow(length: number): number {
        return Math.floor(this.next() * length);
    }
}
