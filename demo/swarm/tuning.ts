import {SpriteImage} from "../../src/engine/rendering/2d";
import {WHITE_RGB} from "../../src/engine/rendering";

export const MS_PER_SECOND = 1000;
export const FIRST_WAVE = 1;
export const MAX_SIMULATION_STEP_MS = 100;

export const FALLBACK_ARENA_WIDTH_UNITS = 80;
export const FALLBACK_ARENA_HEIGHT_UNITS = 24;
export const SPAWN_MARGIN_UNITS = 3;
export const GRID_MARGIN_UNITS = 8;
export const GRID_CELL_SIZE_UNITS = 4;

export const SHIP_SPEED_UNITS_PER_SECOND = 36;
export const SHIP_RADIUS_UNITS = 2;
export const START_LIVES = 3;
export const INVULNERABILITY_MS = 2000;
export const START_INVULNERABILITY_MS = 1500;
export const BLINK_INTERVAL_MS = 100;

export const FIRE_RATE_SHOTS_PER_SECOND = 12;
export const FIRE_INTERVAL_MS = MS_PER_SECOND / FIRE_RATE_SHOTS_PER_SECOND;
export const BULLET_SPEED_UNITS_PER_SECOND = 90;
export const BULLET_LIFETIME_MS = 900;
export const BULLET_RADIUS_UNITS = 0.5;
export const BULLET_DAMAGE = 3;

export const START_BOMBS = 2;
export const MAX_BOMBS = 3;
export const BOMB_EARNED_EVERY_WAVES = 2;
export const BOMB_RADIUS_UNITS = 18;
export const BOMB_SPARKS = 240;
export const LIFE_LOST_SPARKS = 60;
export const SHIP_DESTROYED_SPARKS = 160;
export const LIFE_LOST_SPARK_REACH_UNITS = 8;
export const SHIP_DESTROYED_SPARK_REACH_UNITS = 14;
export const SPARK_MIN_LIFETIME_MS = 450;
export const SPARK_MAX_LIFETIME_MS = 1100;
export const SPARK_MIN_REACH_FRACTION = 0.5;
export const SPARK_MAX_REACH_FRACTION = 1;

export const WAVE_INTERMISSION_MS = 2000;
export const FIRST_WAVE_ENEMY_COUNT = 20;
export const ENEMY_COUNT_GROWTH_PER_WAVE_SQUARED = 25;
export const WAVE_SPAWN_BASE_DURATION_MS = 4000;
export const WAVE_SPAWN_DURATION_GROWTH_MS_PER_WAVE = 700;
export const MAX_SPAWNS_PER_FRAME = 64;
export const BASE_ENEMY_SPEED_MULTIPLIER = 1;
export const ENEMY_SPEED_GROWTH_PER_WAVE = 0.07;
export const MAX_ENEMY_SPEED_MULTIPLIER = 2;
export const ENEMY_SPEED_JITTER_FRACTION = 0.25;
export const MAX_ENEMY_STEER_RAD = 0.5;
export const BRUTE_SHARE_PER_WAVE = 0.04;
export const MAX_BRUTE_SHARE = 0.3;

export const SHIP_DEPTH = 0;
export const BULLET_DEPTH = 1;
export const SPARK_DEPTH = 2;
export const ENEMY_DEPTH = 3;

export const SHIP_RGB = 0x40E0FF;
export const SHIP_COCKPIT_RGB = 0xFFFFFF;
export const SWARMER_RGB = 0xFF3F7F;
export const BRUTE_RGB = 0xFF9020;
export const BRUTE_CORE_RGB = 0xFFE040;
export const BRUTE_WOUNDED_TINT_RGB = 0xFF7070;
export const BULLET_RGB = 0xFFFF80;
export const SPARK_TINTS_RGB: readonly number[] = [0xFFFFFF, 0xFFF4C0, 0xFFD040, 0xFF8020, 0xFF4040];

export const SHIP_IMAGE = SpriteImage.fromPattern([
    "  #  ",
    " #o# ",
    "#####",
    "#   #",
], {"#": SHIP_RGB, "o": SHIP_COCKPIT_RGB});

export const BULLET_IMAGE = SpriteImage.solid(1, 1, BULLET_RGB);
export const SPARK_IMAGE = SpriteImage.solid(1, 1, WHITE_RGB);

export interface EnemyKind {
    readonly name: string;
    readonly image: SpriteImage;
    readonly hitPoints: number;
    readonly radiusUnits: number;
    readonly speedUnitsPerSecond: number;
    readonly score: number;
}

export const SWARMER: EnemyKind = {
    name: "swarmer",
    image: SpriteImage.fromPattern([
        "# #",
        " # ",
    ], {"#": SWARMER_RGB}),
    hitPoints: 1,
    radiusUnits: 1.3,
    speedUnitsPerSecond: 12,
    score: 10,
};

export const BRUTE: EnemyKind = {
    name: "brute",
    image: SpriteImage.fromPattern([
        " ## ",
        "#oo#",
        "#oo#",
        " ## ",
    ], {"#": BRUTE_RGB, "o": BRUTE_CORE_RGB}),
    hitPoints: 6,
    radiusUnits: 2,
    speedUnitsPerSecond: 6.5,
    score: 50,
};

export const MAX_ENEMY_RADIUS_UNITS = Math.max(SWARMER.radiusUnits, BRUTE.radiusUnits);

export function enemyCountForWave(wave: number): number {
    const wavesAfterFirst = wave - FIRST_WAVE;
    return FIRST_WAVE_ENEMY_COUNT + ENEMY_COUNT_GROWTH_PER_WAVE_SQUARED * wavesAfterFirst * wavesAfterFirst;
}

export function spawnDurationMsForWave(wave: number): number {
    return WAVE_SPAWN_BASE_DURATION_MS + WAVE_SPAWN_DURATION_GROWTH_MS_PER_WAVE * (wave - FIRST_WAVE);
}

export function enemySpeedMultiplierForWave(wave: number): number {
    return Math.min(MAX_ENEMY_SPEED_MULTIPLIER, BASE_ENEMY_SPEED_MULTIPLIER + ENEMY_SPEED_GROWTH_PER_WAVE * (wave - FIRST_WAVE));
}

export function bruteShareForWave(wave: number): number {
    return Math.min(MAX_BRUTE_SHARE, BRUTE_SHARE_PER_WAVE * (wave - FIRST_WAVE));
}
