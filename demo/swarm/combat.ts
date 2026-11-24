import {System} from "@jsengine/engine/core";
import type {Entity, EntityCommandBuffer, World} from "@jsengine/engine/core";
import {Input} from "@jsengine/engine/input";
import {Sprite} from "@jsengine/engine/rendering/2d";
import {LocalPosition} from "@jsengine/engine/translation";
import {PrefabSpawner} from "@jsengine/engine/scene";
import {Lifetime, Velocity} from "@jsengine/engine/motion";
import {swarmActionsOf} from "./actions";
import type {SwarmActions} from "./actions";
import {Bullet, Enemy, Spark} from "./components";
import {EnemyGrid} from "./enemyGrid";
import {BOMB_PRIORITY, BROADPHASE_PRIORITY, BULLET_HIT_PRIORITY, SHIP_CONTACT_PRIORITY, SPARK_FADE_PRIORITY} from "./frameOrder";
import {SwarmPhase, SwarmState} from "./resources";
import {
    commandBufferOf,
    ENEMY_PREFAB_FIELD,
    fullExtentOf,
    HIDDEN_OPACITY,
    NO_EXTENT,
    POSITION_STRIDE,
    POSITION_X,
    POSITION_Y,
    randomOf,
    requirePrefab,
    SwarmArena,
    WIDTH_UNITS_PER_SCREEN_UNIT_Y,
} from "./simulation";
import {MS_PER_SECOND, SwarmConfig} from "./config";
import type {SparkConfig} from "./config";

const FULL_TURN_RAD = 2 * Math.PI;
const DEFEATED_HIT_POINTS = 0;

function maxEnemyRadiusUnits(world: World, grid: EnemyGrid): number {
    const spawner = world.resources.get(PrefabSpawner);
    let max = grid.maxRadiusUnits;
    for (const enemy of world.resources.get(SwarmConfig).waves.enemies) {
        const radius = spawner.templateOf(requirePrefab(enemy.prefab, ENEMY_PREFAB_FIELD)).rootComponentDefaults(Enemy)?.radiusUnits ?? NO_EXTENT;
        if (radius > max) max = radius;
    }
    return max;
}

function spawnSparks(buffer: EntityCommandBuffer, world: World, sparks: SparkConfig, x: number, y: number, count: number, reachUnits: number): void {
    const random = randomOf(world), spawner = world.resources.get(PrefabSpawner);
    const prefab = requirePrefab(sparks.prefab, "sparks.prefab");
    const tints = sparks.tints;
    for (let i = 0; i < count; i++) {
        const angle = random.next() * FULL_TURN_RAD;
        const lifetimeMs = random.between(sparks.minLifetimeMs, sparks.maxLifetimeMs);
        const speed = reachUnits * random.between(sparks.minReachFraction, sparks.maxReachFraction) * MS_PER_SECOND / lifetimeMs;
        const spark = spawner.spawn(buffer, prefab);
        const velocity = spark.rootComponent(Velocity);
        velocity.xUnitsPerSecond = Math.cos(angle) * speed;
        velocity.yUnitsPerSecond = Math.sin(angle) * speed / WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        const lifetime = spark.rootComponent(Lifetime);
        lifetime.durationMs = lifetimeMs;
        lifetime.remainingMs = lifetimeMs;
        if (tints.length > 0) spark.rootComponent(Sprite).tint = tints[random.indexBelow(tints.length)];
        const position = spark.rootComponent(LocalPosition);
        position.x = x;
        position.y = y;
    }
}

// Zero HP and hide now: other hits this frame skip the enemy before the ECB destroys it.
function removeEnemyAt(buffer: EntityCommandBuffer, grid: EnemyGrid, index: number): void {
    grid.enemies[index].hitPoints = DEFEATED_HIT_POINTS;
    grid.sprites[index].opacity = HIDDEN_OPACITY;
    buffer.destroyEntity(grid.entities[index] as Entity);
}

function scoreEnemyAt(state: SwarmState, grid: EnemyGrid, index: number): void {
    state.score += grid.enemies[index].points;
    state.kills++;
}

export class SparkFadeSystem extends System {
    private _fading = this.createEntityQuery([Spark, Lifetime, Sprite]);

    override priority(): number {
        return SPARK_FADE_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._fading);
    }

    onUpdate(): void {
        this._fading.stream({read: {lifetime: Lifetime}, write: {sprite: Sprite}}).consume(({lifetime, sprite}) => {
            sprite.opacity = Math.max(HIDDEN_OPACITY, lifetime.remainingMs / lifetime.durationMs);
        });
    }
}

// Never gated: a frame with no enemies must still reset the grid, or consumers would see last frame's enemies.
export class EnemyBroadphaseSystem extends System {
    private _enemies = this.createEntityQuery([Enemy, LocalPosition, Sprite]);

    override priority(): number {
        return BROADPHASE_PRIORITY;
    }

    protected onCreate(): void {
        this.world.resources.getOrCreate(EnemyGrid);
        this.requireResourceForUpdate(SwarmArena);
        this.requireResourceForUpdate(SwarmConfig);
    }

    onUpdate(): void {
        const arena = this.world.resources.get(SwarmArena);
        const arenaConfig = this.world.resources.get(SwarmConfig).arena;
        const grid = this.world.resources.get(EnemyGrid);
        const halfWidth = arena.halfWidthUnits + arenaConfig.broadphaseMarginUnits;
        const halfHeight = arena.halfHeightUnits * WIDTH_UNITS_PER_SCREEN_UNIT_Y + arenaConfig.broadphaseMarginUnits;
        grid.begin(-halfWidth, -halfHeight, fullExtentOf(halfWidth), fullExtentOf(halfHeight), arenaConfig.broadphaseCellSizeUnits, this._enemies.enabledEntityCount());
        this._enemies.stream({read: {enemy: Enemy, position: LocalPosition, sprite: Sprite}}).consumeSpans(({start, end, cols, stores, entities}) => {
            const positions = cols.position!, enemies = stores.enemy!, sprites = stores.sprite!;
            for (let i = start; i < end; i++) {
                const p = i * POSITION_STRIDE;
                grid.add(positions[p + POSITION_X], positions[p + POSITION_Y] * WIDTH_UNITS_PER_SCREEN_UNIT_Y, entities[i], enemies.get(i) as Enemy, sprites.get(i) as Sprite);
            }
        });
        grid.finish();
    }
}

export class BulletHitSystem extends System {
    private _bullets = this.createEntityQuery([Bullet, LocalPosition]);

    override priority(): number {
        return BULLET_HIT_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this.requireResourceForUpdate(EnemyGrid);
        this.requireAnyForUpdate(this._bullets);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const grid = this.world.resources.get(EnemyGrid);
        if (state.phase !== SwarmPhase.Playing || grid.count === 0) return;
        const buffer = commandBufferOf(this.world);
        const maxEnemyRadius = maxEnemyRadiusUnits(this.world, grid);
        this._bullets.stream({read: {position: LocalPosition}, write: {bullet: Bullet}}).consumeSpans(({start, end, cols, stores, entities}) => {
            const positions = cols.position!, bullets = stores.bullet!;
            for (let i = start; i < end; i++) {
                const bullet = bullets.get(i) as Bullet;
                if (bullet.remainingDamage <= 0) continue;
                const p = i * POSITION_STRIDE;
                const x = positions[p + POSITION_X], y = positions[p + POSITION_Y] * WIDTH_UNITS_PER_SCREEN_UNIT_Y;
                const touching = grid.gatherTouching(x, y, bullet.radiusUnits, maxEnemyRadius);
                for (let k = 0; k < touching && bullet.remainingDamage > 0; k++) {
                    const index = grid.candidates[k];
                    const enemy = grid.enemies[index];
                    const dealt = Math.min(bullet.remainingDamage, enemy.hitPoints);
                    enemy.hitPoints -= dealt;
                    bullet.remainingDamage -= dealt;
                    if (enemy.hitPoints > 0) {
                        grid.sprites[index].tint = enemy.woundedTint;
                        continue;
                    }
                    scoreEnemyAt(state, grid, index);
                    removeEnemyAt(buffer, grid, index);
                }
                if (bullet.remainingDamage <= 0) buffer.destroyEntity(entities[i]);
            }
        });
    }
}

export class BombSystem extends System {
    private _actions!: SwarmActions;

    override priority(): number {
        return BOMB_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this.requireResourceForUpdate(EnemyGrid);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing || state.bombs <= 0) return;
        if (!this.world.resources.get(Input).actionPressed(this._actions.Bomb)) return;
        state.bombs--;
        const config = this.world.resources.get(SwarmConfig);
        const radius = config.bomb.radiusUnits;
        const grid = this.world.resources.get(EnemyGrid);
        const buffer = commandBufferOf(this.world);
        const touching = grid.gatherTouching(state.shipX, state.shipY * WIDTH_UNITS_PER_SCREEN_UNIT_Y, radius, maxEnemyRadiusUnits(this.world, grid));
        for (let k = 0; k < touching; k++) {
            const index = grid.candidates[k];
            scoreEnemyAt(state, grid, index);
            removeEnemyAt(buffer, grid, index);
        }
        spawnSparks(buffer, this.world, config.sparks, state.shipX, state.shipY, config.bomb.sparkCount, radius);
    }
}

export class ShipContactSystem extends System {
    override priority(): number {
        return SHIP_CONTACT_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this.requireResourceForUpdate(EnemyGrid);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const grid = this.world.resources.get(EnemyGrid);
        if (state.phase !== SwarmPhase.Playing || state.invulnerableRemainingMs > 0 || grid.count === 0) return;
        const config = this.world.resources.get(SwarmConfig);
        const touching = grid.gatherTouching(state.shipX, state.shipY * WIDTH_UNITS_PER_SCREEN_UNIT_Y, config.ship.radiusUnits, maxEnemyRadiusUnits(this.world, grid));
        if (touching > 0) this.loseLife(state, config, grid, grid.candidates[0]);
    }

    private loseLife(state: SwarmState, config: SwarmConfig, grid: EnemyGrid, index: number): void {
        const buffer = commandBufferOf(this.world), sparks = config.sparks;
        removeEnemyAt(buffer, grid, index);
        state.lives--;
        if (state.lives > 0) {
            state.invulnerableRemainingMs = config.ship.invulnerabilityMs;
            spawnSparks(buffer, this.world, sparks, state.shipX, state.shipY, sparks.lifeLostCount, sparks.lifeLostReachUnits);
            return;
        }
        state.phase = SwarmPhase.GameOver;
        spawnSparks(buffer, this.world, sparks, state.shipX, state.shipY, sparks.shipDestroyedCount, sparks.shipDestroyedReachUnits);
    }
}
