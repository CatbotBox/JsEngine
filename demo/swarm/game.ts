import {EntityCommandBuffer, EntityCommandBufferSystem, Resource, System, World} from "@jsengine/engine/core";
import type {Entity} from "@jsengine/engine/core";
import {Input, resolveInputActions} from "@jsengine/engine/input";
import type {InputAction, ResolvedInputActions} from "@jsengine/engine/input";
import {
    Camera,
    RenderPasses,
    SCREEN_UNIT_HEIGHT_PER_WIDTH,
    ScreenSize,
    SPRITE_PIXELS_PER_SCREEN_UNIT_X,
    SPRITE_PIXELS_PER_SCREEN_UNIT_Y,
} from "@jsengine/engine/rendering";
import {Sprite} from "@jsengine/engine/rendering/2d";
import {LocalPosition} from "@jsengine/engine/translation";
import {DataAssets, dataAssetPathOf, PrefabSpawner} from "@jsengine/engine/scene";
import type {PrefabAsset} from "@jsengine/engine/scene";
import {Random} from "@jsengine/engine/math";
import {Lifetime, LifetimeSystem, MotionSystem, Velocity} from "@jsengine/engine/motion";
import {Bullet, Enemy, Ship, Spark} from "./components";
import {EnemyGrid} from "./enemyGrid";
import {SwarmPhase, SwarmState} from "./resources";
import {MS_PER_SECOND, SWARM_TUNING_FILE, SwarmTuning} from "./tuning";
import type {EnemySpawn, ShipTuning, SparkTuning, WaveTuning} from "./tuning";

const Action = {
    MoveUp: "moveUp",
    MoveDown: "moveDown",
    MoveLeft: "moveLeft",
    MoveRight: "moveRight",
    FireUp: "fireUp",
    FireDown: "fireDown",
    FireLeft: "fireLeft",
    FireRight: "fireRight",
    Bomb: "bomb",
    Start: "start",
    Restart: "restart",
    Quit: "quit",
    ToggleHud: "toggleHud",
} as const;

type SwarmActions = ResolvedInputActions<typeof Action>;

const ARENA_PRIORITY = -140;
const CONTROL_PRIORITY = -130;
const SHIP_PRIORITY = -120;
const WEAPON_PRIORITY = -110;
const WAVE_PRIORITY = -100;
const SEEK_PRIORITY = -90;
const MOTION_PRIORITY = -80;
const LIFETIME_PRIORITY = -70;
const SPARK_FADE_PRIORITY = -60;
const BROADPHASE_PRIORITY = -50;
const BULLET_HIT_PRIORITY = -40;
const BOMB_PRIORITY = -30;
const SHIP_CONTACT_PRIORITY = -20;

const HALF = 0.5;
const UNSCALED = 1;
const FULL_TURN_RAD = 2 * Math.PI;
// Speeds, radii and the grid are in screen-unit widths; scale y by this so motion is isotropic on both backends.
const WIDTH_UNITS_PER_SCREEN_UNIT_Y = SCREEN_UNIT_HEIGHT_PER_WIDTH;
const POSITION_STRIDE = LocalPosition.f32Width;
const POSITION_X = 0;
const POSITION_Y = 1;
const VISIBLE_OPACITY = 1;
const HIDDEN_OPACITY = 0;
const BLINK_PHASES = 2;
const DEFEATED_HIT_POINTS = 0;
const NO_EXTENT = 0;
const STATE_FILE = "assets/swarm.state.asset.json";
const ENEMY_PREFAB_FIELD = "waves.enemies[].prefab";

class SwarmArena extends Resource {
    public halfWidthUnits = 0;
    public halfHeightUnits = 0;
}

function fullExtentOf(halfExtent: number): number {
    return halfExtent / HALF;
}

function randomOf(world: World): Random {
    const random = world.resources.getOrCreate(Random);
    random.reseedIfChanged(world.resources.get(SwarmTuning).randomSeed);
    return random;
}

function simulationStepMs(world: World): number {
    return Math.min(world.time.deltaTimeMs, world.resources.get(SwarmTuning).maxSimulationStepMs);
}

function commandBufferOf(world: World): EntityCommandBuffer {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}

function axis(input: Input, positive: InputAction, negative: InputAction): number {
    return Number(input.actionHeld(positive)) - Number(input.actionHeld(negative));
}

function swarmActionsOf(world: World): SwarmActions {
    return resolveInputActions(world, Action);
}

function requirePrefab(prefab: PrefabAsset | undefined, field: string): PrefabAsset {
    if (prefab === undefined) throw new Error(`SwarmTuning.${field} names no prefab: set it in ${SWARM_TUNING_FILE}`);
    return prefab;
}

function maxEnemyRadiusUnits(world: World, grid: EnemyGrid): number {
    const spawner = world.resources.get(PrefabSpawner);
    let max = grid.maxRadiusUnits;
    for (const enemy of world.resources.get(SwarmTuning).waves.enemies) {
        const radius = spawner.templateOf(requirePrefab(enemy.prefab, ENEMY_PREFAB_FIELD)).rootComponentDefaults(Enemy)?.radiusUnits ?? NO_EXTENT;
        if (radius > max) max = radius;
    }
    return max;
}

function enemySpawnFor(enemies: readonly EnemySpawn[], wavesAfterFirst: number, roll: number): EnemySpawn {
    if (enemies.length === 0) throw new Error(`SwarmTuning.waves.enemies is empty: list at least one enemy prefab in ${SWARM_TUNING_FILE}`);
    let cumulativeShare = 0;
    for (const enemy of enemies) {
        cumulativeShare += enemy.spawnShare.valueAt(wavesAfterFirst);
        if (roll < cumulativeShare) return enemy;
    }
    return enemies[enemies.length - 1];
}

function startNewGame(world: World, state: SwarmState): void {
    const path = dataAssetPathOf(state);
    if (path === undefined || world.resources.get(DataAssets).reload(path) === undefined) {
        throw new Error(`SwarmState has no starting values to reload: load it from ${STATE_FILE} through "resources" in jsengine.project.json`);
    }
    const tuning = world.resources.get(SwarmTuning);
    state.phase = SwarmPhase.Playing;
    state.wave = tuning.waves.firstWave;
    state.lives = tuning.ship.startLives;
    state.bombs = tuning.bomb.startBombs;
    state.invulnerableRemainingMs = tuning.ship.startInvulnerabilityMs;
    state.intermissionRemainingMs = tuning.waves.intermissionMs;
}

function spawnSparks(buffer: EntityCommandBuffer, world: World, sparks: SparkTuning, x: number, y: number, count: number, reachUnits: number): void {
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
    state.score += grid.enemies[index].score;
    state.kills++;
}

function withinReach(grid: EnemyGrid, index: number, x: number, y: number, reach: number): boolean {
    const dx = grid.x[index] - x, dy = grid.y[index] - y;
    return dx * dx + dy * dy <= reach * reach;
}

export class SwarmArenaSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);

    override priority(): number {
        return ARENA_PRIORITY;
    }

    protected onCreate(): void {
        this.world.resources.getOrCreate(SwarmArena);
        this.requireResourceForUpdate(SwarmTuning);
    }

    onUpdate(): void {
        const arena = this.world.resources.get(SwarmArena);
        const fallback = this.world.resources.get(SwarmTuning).arena;
        const camera = this._cameraQuery.tryGetSingleton({screenSize: ScreenSize});
        const width = camera !== undefined && camera.screenSize.x > 0 ? camera.screenSize.x : fallback.fallbackWidthUnits;
        const height = camera !== undefined && camera.screenSize.y > 0 ? camera.screenSize.y : fallback.fallbackHeightUnits;
        arena.halfWidthUnits = width * HALF;
        arena.halfHeightUnits = height * HALF;
    }
}

export class SwarmControlSystem extends System {
    private _enemies = this.createEntityQuery([Enemy]);
    private _bullets = this.createEntityQuery([Bullet]);
    private _sparks = this.createEntityQuery([Spark]);
    private _actions!: SwarmActions;

    override priority(): number {
        return CONTROL_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmTuning);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        const state = this.world.resources.get(SwarmState);
        if (input.actionPressed(this._actions.Quit)) {
            this.world.requestQuit();
            return;
        }
        if (input.actionPressed(this._actions.ToggleHud)) this.world.resources.tryGet(RenderPasses)?.toggle("hudText");
        // Starting lasts one frame: the ECB destroyed the old entities at the end of the frame that queued it, so reset only now.
        if (state.phase === SwarmPhase.Starting) {
            startNewGame(this.world, state);
            return;
        }
        const startPressed = state.phase === SwarmPhase.Title && input.actionPressed(this._actions.Start);
        const restartPressed = state.phase === SwarmPhase.GameOver && input.actionPressed(this._actions.Restart);
        if (startPressed || restartPressed) this.clearField(state);
    }

    private clearField(state: SwarmState): void {
        const buffer = commandBufferOf(this.world);
        buffer.destroyQuery(this._enemies);
        buffer.destroyQuery(this._bullets);
        buffer.destroyQuery(this._sparks);
        state.phase = SwarmPhase.Starting;
    }
}

export class ShipSystem extends System {
    private _ship = this.createEntityQuery([Ship, LocalPosition, Sprite]);
    private _actions!: SwarmActions;

    override priority(): number {
        return SHIP_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmTuning);
        this.requireResourceForUpdate(SwarmArena);
        this.requireAnyForUpdate(this._ship);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const ship = this.world.resources.get(SwarmTuning).ship;
        if (state.phase === SwarmPhase.Playing) {
            const stepMs = simulationStepMs(this.world);
            state.invulnerableRemainingMs = Math.max(0, state.invulnerableRemainingMs - stepMs);
            this.steer(state, ship, this.world.resources.get(Input), stepMs);
        }
        const x = state.shipX, y = state.shipY, opacity = this.opacityOf(state, ship);
        this._ship.stream({write: {position: LocalPosition, sprite: Sprite}}).consume(({position, sprite}) => {
            position.x = x;
            position.y = y;
            sprite.opacity = opacity;
        });
    }

    private steer(state: SwarmState, ship: ShipTuning, input: Input, stepMs: number): void {
        const right = axis(input, this._actions.MoveRight, this._actions.MoveLeft);
        const down = axis(input, this._actions.MoveDown, this._actions.MoveUp);
        if (right !== 0 || down !== 0) {
            const distance = ship.speedUnitsPerSecond * stepMs / MS_PER_SECOND / Math.hypot(right, down);
            state.shipX += right * distance;
            state.shipY += down * distance / WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        }
        const arena = this.world.resources.get(SwarmArena);
        const image = this._ship.tryGetSingleton({sprite: Sprite})?.sprite.image;
        const halfWidth = (image?.sizeX ?? NO_EXTENT) / SPRITE_PIXELS_PER_SCREEN_UNIT_X * HALF;
        const halfHeight = (image?.sizeY ?? NO_EXTENT) / SPRITE_PIXELS_PER_SCREEN_UNIT_Y * HALF;
        const limitX = Math.max(0, arena.halfWidthUnits - halfWidth);
        const limitY = Math.max(0, arena.halfHeightUnits - halfHeight);
        state.shipX = Math.min(limitX, Math.max(-limitX, state.shipX));
        state.shipY = Math.min(limitY, Math.max(-limitY, state.shipY));
    }

    private opacityOf(state: SwarmState, ship: ShipTuning): number {
        if (state.phase !== SwarmPhase.Playing) return HIDDEN_OPACITY;
        if (state.invulnerableRemainingMs <= 0) return VISIBLE_OPACITY;
        return Math.floor(state.invulnerableRemainingMs / ship.blinkIntervalMs) % BLINK_PHASES === 0 ? VISIBLE_OPACITY : HIDDEN_OPACITY;
    }
}

export class ShipWeaponSystem extends System {
    private _actions!: SwarmActions;

    override priority(): number {
        return WEAPON_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmTuning);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
        const input = this.world.resources.get(Input);
        const right = axis(input, this._actions.FireRight, this._actions.FireLeft);
        const down = axis(input, this._actions.FireDown, this._actions.FireUp);
        state.fireCooldownMs -= simulationStepMs(this.world);
        if (right === 0 && down === 0) {
            state.fireCooldownMs = Math.max(0, state.fireCooldownMs);
            return;
        }
        if (state.fireCooldownMs > 0) return;
        const weapon = this.world.resources.get(SwarmTuning).weapon;
        // Carry the overshoot into the next interval so the fire rate does not depend on frame timing.
        state.fireCooldownMs = Math.max(0, state.fireCooldownMs + MS_PER_SECOND / weapon.fireRateShotsPerSecond);

        const speed = weapon.bulletSpeedUnitsPerSecond / Math.hypot(right, down);
        const bullet = this.world.resources.get(PrefabSpawner).spawn(commandBufferOf(this.world), requirePrefab(weapon.bullet, "weapon.bullet"));
        const velocity = bullet.rootComponent(Velocity);
        velocity.xUnitsPerSecond = right * speed;
        velocity.yUnitsPerSecond = down * speed / WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        const position = bullet.rootComponent(LocalPosition);
        position.x = state.shipX;
        position.y = state.shipY;
    }
}

export class WaveSystem extends System {
    private _enemies = this.createEntityQuery([Enemy]);

    override priority(): number {
        return WAVE_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmTuning);
        this.requireResourceForUpdate(SwarmArena);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
        const tuning = this.world.resources.get(SwarmTuning);
        const waves = tuning.waves;
        const stepMs = simulationStepMs(this.world);
        if (state.intermissionRemainingMs > 0) {
            state.intermissionRemainingMs -= stepMs;
            if (state.intermissionRemainingMs > 0) return;
            this.beginWave(state, waves);
        }
        if (state.waveEnemiesSpawned >= state.waveEnemyTarget) {
            if (this._enemies.enabledEntityCount() === 0) this.clearWave(state, tuning);
            return;
        }
        state.spawnBudget += stepMs * state.waveEnemyTarget / waves.spawnDurationMs.valueAt(state.wave - waves.firstWave);
        const spawns = Math.min(Math.floor(state.spawnBudget), state.waveEnemyTarget - state.waveEnemiesSpawned, waves.maxSpawnsPerFrame);
        const buffer = commandBufferOf(this.world);
        for (let i = 0; i < spawns; i++) this.spawnEnemy(state, waves, buffer);
        state.spawnBudget -= spawns;
        state.waveEnemiesSpawned += spawns;
    }

    private beginWave(state: SwarmState, waves: WaveTuning): void {
        state.intermissionRemainingMs = 0;
        state.waveEnemyTarget = waves.enemyCount.valueAt(state.wave - waves.firstWave);
        state.waveEnemiesSpawned = 0;
        state.spawnBudget = 0;
    }

    private clearWave(state: SwarmState, tuning: SwarmTuning): void {
        const clearedWave = state.wave;
        const earnedBomb = clearedWave % tuning.bomb.earnedEveryWaves === 0 && state.bombs < tuning.bomb.maxBombs;
        if (earnedBomb) state.bombs++;
        state.lastClearEarnedBomb = earnedBomb;
        state.wave = clearedWave + 1;
        state.intermissionRemainingMs = tuning.waves.intermissionMs;
        state.waveEnemyTarget = 0;
        state.waveEnemiesSpawned = 0;
        state.spawnBudget = 0;
    }

    private spawnEnemy(state: SwarmState, waves: WaveTuning, buffer: EntityCommandBuffer): void {
        const random = randomOf(this.world), arena = this.world.resources.get(SwarmArena);
        const wavesAfterFirst = state.wave - waves.firstWave;
        const kind = enemySpawnFor(waves.enemies, wavesAfterFirst, random.next());
        const halfWidth = arena.halfWidthUnits + waves.spawnMarginUnits;
        const halfHeight = arena.halfHeightUnits * WIDTH_UNITS_PER_SCREEN_UNIT_Y + waves.spawnMarginUnits;
        const width = fullExtentOf(halfWidth), height = fullExtentOf(halfHeight);
        const topEnd = width, rightEnd = topEnd + height, bottomEnd = rightEnd + width;
        const along = random.next() * (bottomEnd + height);
        let x: number, y: number;
        if (along < topEnd) {
            x = along - halfWidth;
            y = -halfHeight;
        } else if (along < rightEnd) {
            x = halfWidth;
            y = along - topEnd - halfHeight;
        } else if (along < bottomEnd) {
            x = halfWidth - (along - rightEnd);
            y = halfHeight;
        } else {
            x = -halfWidth;
            y = halfHeight - (along - bottomEnd);
        }
        const speedMultiplier = waves.enemySpeedMultiplier.valueAt(wavesAfterFirst);
        const jitter = random.between(UNSCALED - waves.enemySpeedJitterFraction, UNSCALED + waves.enemySpeedJitterFraction);
        const steer = random.between(-waves.maxEnemySteerRad, waves.maxEnemySteerRad);
        const spawned = this.world.resources.get(PrefabSpawner).spawn(buffer, requirePrefab(kind.prefab, ENEMY_PREFAB_FIELD));
        const enemy = spawned.rootComponent(Enemy);
        enemy.speedUnitsPerSecond = enemy.speedUnitsPerSecond * speedMultiplier * jitter;
        enemy.steerCos = Math.cos(steer);
        enemy.steerSin = Math.sin(steer);
        const position = spawned.rootComponent(LocalPosition);
        position.x = x;
        position.y = y / WIDTH_UNITS_PER_SCREEN_UNIT_Y;
    }
}

export class EnemySeekSystem extends System {
    private _enemies = this.createEntityQuery([Enemy, LocalPosition]);

    override priority(): number {
        return SEEK_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmTuning);
        this.requireAnyForUpdate(this._enemies);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
        const stopDistance = this.world.resources.get(SwarmTuning).waves.seekStopDistanceUnits;
        const stepSeconds = simulationStepMs(this.world) / MS_PER_SECOND;
        const targetX = state.shipX, targetY = state.shipY * WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        this._enemies.stream({read: {enemy: Enemy}, write: {position: LocalPosition}}).consumeSpans(({start, end, cols, stores}) => {
            const positions = cols.position!, enemies = stores.enemy!;
            for (let i = start; i < end; i++) {
                const enemy = enemies.get(i) as Enemy;
                const p = i * POSITION_STRIDE;
                const dx = targetX - positions[p + POSITION_X];
                const dy = targetY - positions[p + POSITION_Y] * WIDTH_UNITS_PER_SCREEN_UNIT_Y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= stopDistance) continue;
                const scale = Math.min(enemy.speedUnitsPerSecond * stepSeconds, distance) / distance;
                const stepX = dx * scale, stepY = dy * scale;
                positions[p + POSITION_X] += stepX * enemy.steerCos - stepY * enemy.steerSin;
                positions[p + POSITION_Y] += (stepX * enemy.steerSin + stepY * enemy.steerCos) / WIDTH_UNITS_PER_SCREEN_UNIT_Y;
            }
        });
    }
}

export class SwarmMotionSystem extends MotionSystem {
    override priority(): number {
        return MOTION_PRIORITY;
    }

    protected override onCreate(): void {
        this.requireResourceForUpdate(SwarmTuning);
        super.onCreate();
    }

    protected override stepMs(): number {
        return simulationStepMs(this.world);
    }
}

export class SwarmLifetimeSystem extends LifetimeSystem {
    override priority(): number {
        return LIFETIME_PRIORITY;
    }

    protected override onCreate(): void {
        this.requireResourceForUpdate(SwarmTuning);
        super.onCreate();
    }

    protected override stepMs(): number {
        return simulationStepMs(this.world);
    }
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
        this.requireResourceForUpdate(SwarmTuning);
    }

    onUpdate(): void {
        const arena = this.world.resources.get(SwarmArena);
        const tuning = this.world.resources.get(SwarmTuning).arena;
        const grid = this.world.resources.get(EnemyGrid);
        const halfWidth = arena.halfWidthUnits + tuning.broadphaseMarginUnits;
        const halfHeight = arena.halfHeightUnits * WIDTH_UNITS_PER_SCREEN_UNIT_Y + tuning.broadphaseMarginUnits;
        grid.begin(-halfWidth, -halfHeight, fullExtentOf(halfWidth), fullExtentOf(halfHeight), tuning.broadphaseCellSizeUnits, this._enemies.enabledEntityCount());
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
        this.requireResourceForUpdate(SwarmTuning);
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
                const found = grid.gatherNear(x, y, bullet.radiusUnits + maxEnemyRadius);
                for (let k = 0; k < found && bullet.remainingDamage > 0; k++) {
                    const index = grid.candidates[k];
                    const enemy = grid.enemies[index];
                    if (enemy.hitPoints <= 0 || !withinReach(grid, index, x, y, bullet.radiusUnits + enemy.radiusUnits)) continue;
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
        this.requireResourceForUpdate(SwarmTuning);
        this.requireResourceForUpdate(EnemyGrid);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing || state.bombs <= 0) return;
        if (!this.world.resources.get(Input).actionPressed(this._actions.Bomb)) return;
        state.bombs--;
        const tuning = this.world.resources.get(SwarmTuning);
        const radius = tuning.bomb.radiusUnits;
        const grid = this.world.resources.get(EnemyGrid);
        const buffer = commandBufferOf(this.world);
        const x = state.shipX, y = state.shipY * WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        const found = grid.gatherNear(x, y, radius + maxEnemyRadiusUnits(this.world, grid));
        for (let k = 0; k < found; k++) {
            const index = grid.candidates[k];
            const enemy = grid.enemies[index];
            if (enemy.hitPoints <= 0 || !withinReach(grid, index, x, y, radius + enemy.radiusUnits)) continue;
            scoreEnemyAt(state, grid, index);
            removeEnemyAt(buffer, grid, index);
        }
        spawnSparks(buffer, this.world, tuning.sparks, state.shipX, state.shipY, tuning.bomb.sparkCount, radius);
    }
}

export class ShipContactSystem extends System {
    override priority(): number {
        return SHIP_CONTACT_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmTuning);
        this.requireResourceForUpdate(EnemyGrid);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const grid = this.world.resources.get(EnemyGrid);
        if (state.phase !== SwarmPhase.Playing || state.invulnerableRemainingMs > 0 || grid.count === 0) return;
        const tuning = this.world.resources.get(SwarmTuning);
        const shipRadius = tuning.ship.radiusUnits;
        const x = state.shipX, y = state.shipY * WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        const found = grid.gatherNear(x, y, shipRadius + maxEnemyRadiusUnits(this.world, grid));
        for (let k = 0; k < found; k++) {
            const index = grid.candidates[k];
            const enemy = grid.enemies[index];
            if (enemy.hitPoints <= 0 || !withinReach(grid, index, x, y, shipRadius + enemy.radiusUnits)) continue;
            this.loseLife(state, tuning, grid, index);
            return;
        }
    }

    private loseLife(state: SwarmState, tuning: SwarmTuning, grid: EnemyGrid, index: number): void {
        const buffer = commandBufferOf(this.world), sparks = tuning.sparks;
        removeEnemyAt(buffer, grid, index);
        state.lives--;
        if (state.lives > 0) {
            state.invulnerableRemainingMs = tuning.ship.invulnerabilityMs;
            spawnSparks(buffer, this.world, sparks, state.shipX, state.shipY, sparks.lifeLostCount, sparks.lifeLostReachUnits);
            return;
        }
        state.phase = SwarmPhase.GameOver;
        spawnSparks(buffer, this.world, sparks, state.shipX, state.shipY, sparks.shipDestroyedCount, sparks.shipDestroyedReachUnits);
    }
}

