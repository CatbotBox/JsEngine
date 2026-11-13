import {EntityCommandBuffer, EntityCommandBufferSystem, Resource, System, World} from "../../src/engine/core";
import type {Entity} from "../../src/engine/core";
import {Input, Key} from "../../src/engine/input";
import type {ActionBindings} from "../../src/engine/input";
import {
    Camera,
    SCREEN_UNIT_HEIGHT_PER_WIDTH,
    ScreenSize,
    SPRITE_PIXELS_PER_SCREEN_UNIT_X,
    SPRITE_PIXELS_PER_SCREEN_UNIT_Y,
    TextColor,
} from "../../src/engine/rendering";
import type {TextSprite} from "../../src/engine/rendering";
import {Sprite} from "../../src/engine/rendering/2d";
import {LocalPosition, LocalToWorld} from "../../src/engine/translation";
import {AverageStat} from "../../src/engine/datatypes";
import {createHudLabel} from "../_shared/hud";
import {Bullet, Enemy, Lifetime, Ship, Spark, Velocity} from "./components";
import {EnemyGrid} from "./enemyGrid";
import {SeededRandom, SwarmPhase, SwarmState} from "./resources";
import {
    BLINK_INTERVAL_MS,
    BOMB_EARNED_EVERY_WAVES,
    BOMB_RADIUS_UNITS,
    BOMB_SPARKS,
    BRUTE,
    BRUTE_WOUNDED_TINT_RGB,
    BULLET_DAMAGE,
    BULLET_DEPTH,
    BULLET_IMAGE,
    BULLET_LIFETIME_MS,
    BULLET_RADIUS_UNITS,
    BULLET_SPEED_UNITS_PER_SECOND,
    bruteShareForWave,
    ENEMY_DEPTH,
    ENEMY_SPEED_JITTER_FRACTION,
    enemyCountForWave,
    enemySpeedMultiplierForWave,
    FALLBACK_ARENA_HEIGHT_UNITS,
    FALLBACK_ARENA_WIDTH_UNITS,
    FIRE_INTERVAL_MS,
    GRID_CELL_SIZE_UNITS,
    GRID_MARGIN_UNITS,
    INVULNERABILITY_MS,
    LIFE_LOST_SPARK_REACH_UNITS,
    LIFE_LOST_SPARKS,
    MAX_BOMBS,
    MAX_ENEMY_RADIUS_UNITS,
    MAX_ENEMY_STEER_RAD,
    MAX_SIMULATION_STEP_MS,
    MAX_SPAWNS_PER_FRAME,
    MS_PER_SECOND,
    SHIP_DEPTH,
    SHIP_DESTROYED_SPARK_REACH_UNITS,
    SHIP_DESTROYED_SPARKS,
    SHIP_IMAGE,
    SHIP_RADIUS_UNITS,
    SHIP_SPEED_UNITS_PER_SECOND,
    SPARK_DEPTH,
    SPARK_IMAGE,
    SPARK_MAX_LIFETIME_MS,
    SPARK_MAX_REACH_FRACTION,
    SPARK_MIN_LIFETIME_MS,
    SPARK_MIN_REACH_FRACTION,
    SPARK_TINTS_RGB,
    SPAWN_MARGIN_UNITS,
    spawnDurationMsForWave,
    SWARMER,
    WAVE_INTERMISSION_MS,
} from "./tuning";

export interface SwarmRenderControls {
    toggleHud(): void;
}

export interface SwarmHost {
    readonly render: SwarmRenderControls;
    readonly seed?: number;
    quit(): void;
}

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

const SWARM_ACTIONS: ActionBindings = {
    [Action.MoveUp]: [Key.W],
    [Action.MoveDown]: [Key.S],
    [Action.MoveLeft]: [Key.A],
    [Action.MoveRight]: [Key.D],
    [Action.FireUp]: [Key.Up],
    [Action.FireDown]: [Key.Down],
    [Action.FireLeft]: [Key.Left],
    [Action.FireRight]: [Key.Right],
    [Action.Bomb]: [Key.Space],
    [Action.Start]: [Key.Enter],
    [Action.Restart]: [Key.R],
    [Action.Quit]: [Key.Escape],
    [Action.ToggleHud]: [Key.Tab],
};

const ARENA_PRIORITY = -120;
const CONTROL_PRIORITY = -110;
const SHIP_PRIORITY = -90;
const WEAPON_PRIORITY = -85;
const WAVE_PRIORITY = -80;
const SEEK_PRIORITY = -70;
const MOTION_PRIORITY = -60;
const LIFETIME_PRIORITY = -55;
const BROADPHASE_PRIORITY = -50;
const BULLET_HIT_PRIORITY = -45;
const BOMB_PRIORITY = -44;
const SHIP_CONTACT_PRIORITY = -43;
const HUD_PRIORITY = -5;

const HALF = 0.5;
const UNSCALED = 1;
const FULL_TURN_RAD = 2 * Math.PI;
const WIDTH_UNITS_PER_SCREEN_UNIT_Y = SCREEN_UNIT_HEIGHT_PER_WIDTH;
const POSITION_STRIDE = LocalPosition.f32Width;
const POSITION_X = 0;
const POSITION_Y = 1;
const SHIP_HALF_WIDTH_SCREEN_UNITS = SHIP_IMAGE.sizeX / SPRITE_PIXELS_PER_SCREEN_UNIT_X * HALF;
const SHIP_HALF_HEIGHT_SCREEN_UNITS = SHIP_IMAGE.sizeY / SPRITE_PIXELS_PER_SCREEN_UNIT_Y * HALF;
const SEEK_STOP_DISTANCE_UNITS = 0.01;
const VISIBLE_OPACITY = 1;
const HIDDEN_OPACITY = 0;
const BLINK_PHASES = 2;
const DEFEATED_HIT_POINTS = 0;

const FPS_AVERAGE_FRAMES = 30;
const STATS_REFRESH_MS = 250;
const UNSHOWN = -1;
const STATUS_SEPARATOR = "   ";
const STATUS_COLOR = TextColor.BRIGHT_GREEN;
const STATS_COLOR = TextColor.GREEN;
const TITLE_COLOR = TextColor.BRIGHT_CYAN;
const WAVE_BANNER_COLOR = TextColor.BRIGHT_YELLOW;
const GAME_OVER_COLOR = TextColor.BRIGHT_RED;
const HUD_BACKGROUND = TextColor.BLACK;
const PANEL_PADDING_COLUMNS = 2;
const NO_TEXT: string[] = [];
const BLANK_LINE = "";
const SPACE = " ";

type BannerKind = "none" | "title" | "wave" | "gameOver";

function centeredPanel(lines: readonly string[]): string[] {
    let width = 0;
    for (const line of lines) width = Math.max(width, line.length);
    const padding = SPACE.repeat(PANEL_PADDING_COLUMNS);
    const rows = [BLANK_LINE, ...lines, BLANK_LINE];
    return rows.map(line => padding + (SPACE.repeat(Math.floor((width - line.length) * HALF)) + line).padEnd(width) + padding);
}

const CONTROL_KEY_COLUMNS = 9;
const CONTROLS: readonly (readonly [string, string])[] = [
    ["WASD", "move"],
    ["ARROWS", "fire, hold to repeat"],
    ["SPACE", "bomb"],
    ["TAB", "toggle HUD"],
    ["ESC", "quit"],
];

function controlLines(): string[] {
    const lines = CONTROLS.map(([keys, effect]) => keys.padEnd(CONTROL_KEY_COLUMNS) + effect);
    let width = 0;
    for (const line of lines) width = Math.max(width, line.length);
    return lines.map(line => line.padEnd(width));
}

const TITLE_LINES = centeredPanel([
    "S W A R M",
    BLANK_LINE,
    ...controlLines(),
    BLANK_LINE,
    "press ENTER to start",
]);

function waveBannerLines(state: SwarmState): string[] {
    const lines = [`W A V E   ${state.wave}`];
    if (state.lastClearEarnedBomb) lines.push(BLANK_LINE, "+1 BOMB");
    return centeredPanel(lines);
}

function gameOverLines(state: SwarmState): string[] {
    return centeredPanel([
        "GAME OVER",
        BLANK_LINE,
        ["SCORE " + state.score, "WAVE " + state.wave, "KILLS " + state.kills].join(STATUS_SEPARATOR),
        BLANK_LINE,
        "press R to restart" + STATUS_SEPARATOR + "ESC to quit",
    ]);
}

class SwarmHostResource extends Resource {
    public constructor(public readonly host: SwarmHost) {
        super();
    }
}

class SwarmHudLabels extends Resource {
    public constructor(
        public readonly status: TextSprite,
        public readonly stats: TextSprite,
        public readonly banner: TextSprite,
    ) {
        super();
    }
}

function fullExtentOf(halfExtent: number): number {
    return halfExtent / HALF;
}

function simulationStepMs(world: World): number {
    return Math.min(world.time.deltaTimeMs, MAX_SIMULATION_STEP_MS);
}

function commandBufferOf(world: World): EntityCommandBuffer {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}

function axis(input: Input, positive: string, negative: string): number {
    return Number(input.actionHeld(positive)) - Number(input.actionHeld(negative));
}

function quitRequested(input: Input): boolean {
    if (input.actionPressed(Action.Quit)) return true;
    for (const event of input.events) {
        if (event.type === "keyDown" && event.key === Key.C && event.ctrl) return true;
    }
    return false;
}

function spawnSparks(buffer: EntityCommandBuffer, random: SeededRandom, x: number, y: number, count: number, reachUnits: number): void {
    for (let i = 0; i < count; i++) {
        const angle = random.next() * FULL_TURN_RAD;
        const lifetimeMs = random.between(SPARK_MIN_LIFETIME_MS, SPARK_MAX_LIFETIME_MS);
        const speed = reachUnits * random.between(SPARK_MIN_REACH_FRACTION, SPARK_MAX_REACH_FRACTION) * MS_PER_SECOND / lifetimeMs;
        buffer.createEntity("spark", [
            new Spark(),
            new Velocity(Math.cos(angle) * speed, Math.sin(angle) * speed / WIDTH_UNITS_PER_SCREEN_UNIT_Y),
            new Lifetime(lifetimeMs),
            new Sprite(SPARK_IMAGE, SPARK_TINTS_RGB[random.indexBelow(SPARK_TINTS_RGB.length)]),
            new LocalPosition(x, y, SPARK_DEPTH),
            new LocalToWorld(),
        ]);
    }
}

function removeEnemyAt(buffer: EntityCommandBuffer, grid: EnemyGrid, index: number): void {
    grid.enemies[index].hitPoints = DEFEATED_HIT_POINTS;
    grid.sprites[index].opacity = HIDDEN_OPACITY;
    buffer.destroyEntity(grid.entities[index] as Entity);
}

function scoreEnemyAt(state: SwarmState, grid: EnemyGrid, index: number): void {
    state.score += grid.enemies[index].kind.score;
    state.kills++;
}

function withinReach(grid: EnemyGrid, index: number, x: number, y: number, reach: number): boolean {
    const dx = grid.x[index] - x, dy = grid.y[index] - y;
    return dx * dx + dy * dy <= reach * reach;
}

class SwarmArenaSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);

    override priority(): number {
        return ARENA_PRIORITY;
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const camera = this._cameraQuery.tryGetSingleton({screenSize: ScreenSize});
        const width = camera !== undefined && camera.screenSize.x > 0 ? camera.screenSize.x : FALLBACK_ARENA_WIDTH_UNITS;
        const height = camera !== undefined && camera.screenSize.y > 0 ? camera.screenSize.y : FALLBACK_ARENA_HEIGHT_UNITS;
        state.arenaHalfWidthUnits = width * HALF;
        state.arenaHalfHeightUnits = height * HALF;
    }
}

class SwarmControlSystem extends System {
    private _enemies = this.createEntityQuery([Enemy]);
    private _bullets = this.createEntityQuery([Bullet]);
    private _sparks = this.createEntityQuery([Spark]);

    override priority(): number {
        return CONTROL_PRIORITY;
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        const state = this.world.resources.get(SwarmState);
        const host = this.world.resources.get(SwarmHostResource).host;
        if (quitRequested(input)) {
            this.world.stop();
            host.quit();
            return;
        }
        if (input.actionPressed(Action.ToggleHud)) host.render.toggleHud();
        if (state.phase === SwarmPhase.Starting) {
            state.resetForNewGame();
            return;
        }
        const startPressed = state.phase === SwarmPhase.Title && input.actionPressed(Action.Start);
        const restartPressed = state.phase === SwarmPhase.GameOver && input.actionPressed(Action.Restart);
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

class ShipSystem extends System {
    private _ship = this.createEntityQuery([Ship, LocalPosition, Sprite]);

    override priority(): number {
        return SHIP_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._ship);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase === SwarmPhase.Playing) {
            const stepMs = simulationStepMs(this.world);
            state.invulnerableRemainingMs = Math.max(0, state.invulnerableRemainingMs - stepMs);
            this.steer(state, this.world.resources.get(Input), stepMs);
        }
        const x = state.shipX, y = state.shipY, opacity = this.opacityOf(state);
        this._ship.stream({write: {position: LocalPosition, sprite: Sprite}}).consume(({position, sprite}) => {
            position.x = x;
            position.y = y;
            sprite.opacity = opacity;
        });
    }

    private steer(state: SwarmState, input: Input, stepMs: number): void {
        const right = axis(input, Action.MoveRight, Action.MoveLeft);
        const down = axis(input, Action.MoveDown, Action.MoveUp);
        if (right !== 0 || down !== 0) {
            const distance = SHIP_SPEED_UNITS_PER_SECOND * stepMs / MS_PER_SECOND / Math.hypot(right, down);
            state.shipX += right * distance;
            state.shipY += down * distance / WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        }
        const limitX = Math.max(0, state.arenaHalfWidthUnits - SHIP_HALF_WIDTH_SCREEN_UNITS);
        const limitY = Math.max(0, state.arenaHalfHeightUnits - SHIP_HALF_HEIGHT_SCREEN_UNITS);
        state.shipX = Math.min(limitX, Math.max(-limitX, state.shipX));
        state.shipY = Math.min(limitY, Math.max(-limitY, state.shipY));
    }

    private opacityOf(state: SwarmState): number {
        if (state.phase !== SwarmPhase.Playing) return HIDDEN_OPACITY;
        if (state.invulnerableRemainingMs <= 0) return VISIBLE_OPACITY;
        return Math.floor(state.invulnerableRemainingMs / BLINK_INTERVAL_MS) % BLINK_PHASES === 0 ? VISIBLE_OPACITY : HIDDEN_OPACITY;
    }
}

class ShipWeaponSystem extends System {
    override priority(): number {
        return WEAPON_PRIORITY;
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
        const input = this.world.resources.get(Input);
        const right = axis(input, Action.FireRight, Action.FireLeft);
        const down = axis(input, Action.FireDown, Action.FireUp);
        state.fireCooldownMs -= simulationStepMs(this.world);
        if (right === 0 && down === 0) {
            state.fireCooldownMs = Math.max(0, state.fireCooldownMs);
            return;
        }
        if (state.fireCooldownMs > 0) return;
        state.fireCooldownMs = Math.max(0, state.fireCooldownMs + FIRE_INTERVAL_MS);

        const speed = BULLET_SPEED_UNITS_PER_SECOND / Math.hypot(right, down);
        commandBufferOf(this.world).createEntity("bullet", [
            new Bullet(BULLET_DAMAGE),
            new Velocity(right * speed, down * speed / WIDTH_UNITS_PER_SCREEN_UNIT_Y),
            new Lifetime(BULLET_LIFETIME_MS),
            new Sprite(BULLET_IMAGE),
            new LocalPosition(state.shipX, state.shipY, BULLET_DEPTH),
            new LocalToWorld(),
        ]);
    }
}

class WaveSystem extends System {
    private _enemies = this.createEntityQuery([Enemy]);

    override priority(): number {
        return WAVE_PRIORITY;
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
        const stepMs = simulationStepMs(this.world);
        if (state.intermissionRemainingMs > 0) {
            state.intermissionRemainingMs -= stepMs;
            if (state.intermissionRemainingMs > 0) return;
            this.beginWave(state);
        }
        if (state.waveEnemiesSpawned >= state.waveEnemyTarget) {
            if (this._enemies.enabledEntityCount() === 0) this.clearWave(state);
            return;
        }
        state.spawnBudget += stepMs * state.waveEnemyTarget / spawnDurationMsForWave(state.wave);
        const spawns = Math.min(Math.floor(state.spawnBudget), state.waveEnemyTarget - state.waveEnemiesSpawned, MAX_SPAWNS_PER_FRAME);
        const buffer = commandBufferOf(this.world), random = this.world.resources.get(SeededRandom);
        for (let i = 0; i < spawns; i++) this.spawnEnemy(state, random, buffer);
        state.spawnBudget -= spawns;
        state.waveEnemiesSpawned += spawns;
    }

    private beginWave(state: SwarmState): void {
        state.intermissionRemainingMs = 0;
        state.waveEnemyTarget = enemyCountForWave(state.wave);
        state.waveEnemiesSpawned = 0;
        state.spawnBudget = 0;
    }

    private clearWave(state: SwarmState): void {
        const clearedWave = state.wave;
        const earnedBomb = clearedWave % BOMB_EARNED_EVERY_WAVES === 0 && state.bombs < MAX_BOMBS;
        if (earnedBomb) state.bombs++;
        state.lastClearEarnedBomb = earnedBomb;
        state.wave = clearedWave + 1;
        state.intermissionRemainingMs = WAVE_INTERMISSION_MS;
        state.waveEnemyTarget = 0;
        state.waveEnemiesSpawned = 0;
        state.spawnBudget = 0;
    }

    private spawnEnemy(state: SwarmState, random: SeededRandom, buffer: EntityCommandBuffer): void {
        const kind = random.next() < bruteShareForWave(state.wave) ? BRUTE : SWARMER;
        const halfWidth = state.arenaHalfWidthUnits + SPAWN_MARGIN_UNITS;
        const halfHeight = state.arenaHalfHeightUnits * WIDTH_UNITS_PER_SCREEN_UNIT_Y + SPAWN_MARGIN_UNITS;
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
        const speed = kind.speedUnitsPerSecond * enemySpeedMultiplierForWave(state.wave)
            * random.between(UNSCALED - ENEMY_SPEED_JITTER_FRACTION, UNSCALED + ENEMY_SPEED_JITTER_FRACTION);
        const steer = random.between(-MAX_ENEMY_STEER_RAD, MAX_ENEMY_STEER_RAD);
        buffer.createEntity(kind.name, [
            new Enemy(kind, speed, Math.cos(steer), Math.sin(steer)),
            new Sprite(kind.image),
            new LocalPosition(x, y / WIDTH_UNITS_PER_SCREEN_UNIT_Y, ENEMY_DEPTH),
            new LocalToWorld(),
        ]);
    }
}

class EnemySeekSystem extends System {
    private _enemies = this.createEntityQuery([Enemy, LocalPosition]);

    override priority(): number {
        return SEEK_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._enemies);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
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
                if (distance <= SEEK_STOP_DISTANCE_UNITS) continue;
                const scale = Math.min(enemy.speedUnitsPerSecond * stepSeconds, distance) / distance;
                const stepX = dx * scale, stepY = dy * scale;
                positions[p + POSITION_X] += stepX * enemy.steerCos - stepY * enemy.steerSin;
                positions[p + POSITION_Y] += (stepX * enemy.steerSin + stepY * enemy.steerCos) / WIDTH_UNITS_PER_SCREEN_UNIT_Y;
            }
        });
    }
}

class MotionSystem extends System {
    private _moving = this.createEntityQuery([Velocity, LocalPosition]);

    override priority(): number {
        return MOTION_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._moving);
    }

    onUpdate(): void {
        const stepSeconds = simulationStepMs(this.world) / MS_PER_SECOND;
        this._moving.stream({read: {velocity: Velocity}, write: {position: LocalPosition}}).consumeSpans(({start, end, cols, stores}) => {
            const positions = cols.position!, velocities = stores.velocity!;
            for (let i = start; i < end; i++) {
                const velocity = velocities.get(i) as Velocity;
                const p = i * POSITION_STRIDE;
                positions[p + POSITION_X] += velocity.xUnitsPerSecond * stepSeconds;
                positions[p + POSITION_Y] += velocity.yUnitsPerSecond * stepSeconds;
            }
        });
    }
}

class LifetimeSystem extends System {
    private _lifetimes = this.createEntityQuery([Lifetime]);
    private _fading = this.createEntityQuery([Spark, Lifetime, Sprite]);

    override priority(): number {
        return LIFETIME_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._lifetimes);
    }

    onUpdate(): void {
        const stepMs = simulationStepMs(this.world);
        const buffer = commandBufferOf(this.world);
        this._lifetimes.stream({write: {lifetime: Lifetime}}, {includeEntity: true}).consume(({entity, lifetime}) => {
            lifetime.remainingMs -= stepMs;
            if (lifetime.remainingMs <= 0) buffer.destroyEntity(entity);
        });
        this._fading.stream({read: {lifetime: Lifetime}, write: {sprite: Sprite}}).consume(({lifetime, sprite}) => {
            sprite.opacity = Math.max(HIDDEN_OPACITY, lifetime.remainingMs / lifetime.durationMs);
        });
    }
}

class EnemyBroadphaseSystem extends System {
    private _enemies = this.createEntityQuery([Enemy, LocalPosition, Sprite]);

    override priority(): number {
        return BROADPHASE_PRIORITY;
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const grid = this.world.resources.get(EnemyGrid);
        const halfWidth = state.arenaHalfWidthUnits + GRID_MARGIN_UNITS;
        const halfHeight = state.arenaHalfHeightUnits * WIDTH_UNITS_PER_SCREEN_UNIT_Y + GRID_MARGIN_UNITS;
        grid.begin(-halfWidth, -halfHeight, fullExtentOf(halfWidth), fullExtentOf(halfHeight), GRID_CELL_SIZE_UNITS, this._enemies.enabledEntityCount());
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

class BulletHitSystem extends System {
    private _bullets = this.createEntityQuery([Bullet, LocalPosition]);

    override priority(): number {
        return BULLET_HIT_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._bullets);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const grid = this.world.resources.get(EnemyGrid);
        if (state.phase !== SwarmPhase.Playing || grid.count === 0) return;
        const buffer = commandBufferOf(this.world);
        const searchRadius = BULLET_RADIUS_UNITS + MAX_ENEMY_RADIUS_UNITS;
        this._bullets.stream({read: {position: LocalPosition}, write: {bullet: Bullet}}).consumeSpans(({start, end, cols, stores, entities}) => {
            const positions = cols.position!, bullets = stores.bullet!;
            for (let i = start; i < end; i++) {
                const bullet = bullets.get(i) as Bullet;
                if (bullet.remainingDamage <= 0) continue;
                const p = i * POSITION_STRIDE;
                const x = positions[p + POSITION_X], y = positions[p + POSITION_Y] * WIDTH_UNITS_PER_SCREEN_UNIT_Y;
                const found = grid.gatherNear(x, y, searchRadius);
                for (let k = 0; k < found && bullet.remainingDamage > 0; k++) {
                    const index = grid.candidates[k];
                    const enemy = grid.enemies[index];
                    if (enemy.hitPoints <= 0 || !withinReach(grid, index, x, y, BULLET_RADIUS_UNITS + enemy.kind.radiusUnits)) continue;
                    const dealt = Math.min(bullet.remainingDamage, enemy.hitPoints);
                    enemy.hitPoints -= dealt;
                    bullet.remainingDamage -= dealt;
                    if (enemy.hitPoints > 0) {
                        grid.sprites[index].tint = BRUTE_WOUNDED_TINT_RGB;
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

class BombSystem extends System {
    override priority(): number {
        return BOMB_PRIORITY;
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing || state.bombs <= 0) return;
        if (!this.world.resources.get(Input).actionPressed(Action.Bomb)) return;
        state.bombs--;
        const grid = this.world.resources.get(EnemyGrid);
        const buffer = commandBufferOf(this.world);
        const x = state.shipX, y = state.shipY * WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        const found = grid.gatherNear(x, y, BOMB_RADIUS_UNITS + MAX_ENEMY_RADIUS_UNITS);
        for (let k = 0; k < found; k++) {
            const index = grid.candidates[k];
            const enemy = grid.enemies[index];
            if (enemy.hitPoints <= 0 || !withinReach(grid, index, x, y, BOMB_RADIUS_UNITS + enemy.kind.radiusUnits)) continue;
            scoreEnemyAt(state, grid, index);
            removeEnemyAt(buffer, grid, index);
        }
        spawnSparks(buffer, this.world.resources.get(SeededRandom), state.shipX, state.shipY, BOMB_SPARKS, BOMB_RADIUS_UNITS);
    }
}

class ShipContactSystem extends System {
    override priority(): number {
        return SHIP_CONTACT_PRIORITY;
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const grid = this.world.resources.get(EnemyGrid);
        if (state.phase !== SwarmPhase.Playing || state.invulnerableRemainingMs > 0 || grid.count === 0) return;
        const x = state.shipX, y = state.shipY * WIDTH_UNITS_PER_SCREEN_UNIT_Y;
        const found = grid.gatherNear(x, y, SHIP_RADIUS_UNITS + MAX_ENEMY_RADIUS_UNITS);
        for (let k = 0; k < found; k++) {
            const index = grid.candidates[k];
            const enemy = grid.enemies[index];
            if (enemy.hitPoints <= 0 || !withinReach(grid, index, x, y, SHIP_RADIUS_UNITS + enemy.kind.radiusUnits)) continue;
            this.loseLife(state, grid, index);
            return;
        }
    }

    private loseLife(state: SwarmState, grid: EnemyGrid, index: number): void {
        const buffer = commandBufferOf(this.world), random = this.world.resources.get(SeededRandom);
        removeEnemyAt(buffer, grid, index);
        state.lives--;
        if (state.lives > 0) {
            state.invulnerableRemainingMs = INVULNERABILITY_MS;
            spawnSparks(buffer, random, state.shipX, state.shipY, LIFE_LOST_SPARKS, LIFE_LOST_SPARK_REACH_UNITS);
            return;
        }
        state.phase = SwarmPhase.GameOver;
        spawnSparks(buffer, random, state.shipX, state.shipY, SHIP_DESTROYED_SPARKS, SHIP_DESTROYED_SPARK_REACH_UNITS);
    }
}

class SwarmHudSystem extends System {
    private _enemies = this.createEntityQuery([Enemy]);
    private _fps = new AverageStat(FPS_AVERAGE_FRAMES);
    private _sinceStatsRefreshMs = STATS_REFRESH_MS;
    private _shownPhase: SwarmPhase | undefined;
    private _shownScore = UNSHOWN;
    private _shownWave = UNSHOWN;
    private _shownLives = UNSHOWN;
    private _shownBombs = UNSHOWN;
    private _shownBanner: BannerKind | undefined;
    private _shownBannerWave = UNSHOWN;

    override priority(): number {
        return HUD_PRIORITY;
    }

    onUpdate(): void {
        const labels = this.world.resources.get(SwarmHudLabels);
        const state = this.world.resources.get(SwarmState);
        this.refreshStatus(labels.status, state);
        this.refreshStats(labels.stats);
        this.refreshBanner(labels.banner, state);
    }

    private refreshStatus(label: TextSprite, state: SwarmState): void {
        if (state.phase === this._shownPhase && state.score === this._shownScore && state.wave === this._shownWave
            && state.lives === this._shownLives && state.bombs === this._shownBombs) return;
        this._shownPhase = state.phase;
        this._shownScore = state.score;
        this._shownWave = state.wave;
        this._shownLives = state.lives;
        this._shownBombs = state.bombs;
        label.image = state.phase === SwarmPhase.Title ? NO_TEXT : [[
            "SCORE " + state.score,
            "WAVE " + state.wave,
            "LIVES " + state.lives,
            "BOMBS " + state.bombs,
        ].join(STATUS_SEPARATOR)];
    }

    private refreshStats(label: TextSprite): void {
        const deltaTimeMs = this.world.time.deltaTimeMs;
        if (deltaTimeMs > 0) this._fps.add(MS_PER_SECOND / deltaTimeMs);
        this._sinceStatsRefreshMs += deltaTimeMs;
        if (this._sinceStatsRefreshMs < STATS_REFRESH_MS) return;
        this._sinceStatsRefreshMs = 0;
        label.image = [["ENEMIES " + this._enemies.enabledEntityCount(), "FPS " + Math.round(this._fps.getAvg())].join(STATUS_SEPARATOR)];
    }

    private refreshBanner(label: TextSprite, state: SwarmState): void {
        const banner = this.bannerOf(state);
        if (banner === this._shownBanner && state.wave === this._shownBannerWave) return;
        this._shownBanner = banner;
        this._shownBannerWave = state.wave;
        switch (banner) {
            case "title":
                label.foreground = TITLE_COLOR;
                label.image = TITLE_LINES;
                break;
            case "wave":
                label.foreground = WAVE_BANNER_COLOR;
                label.image = waveBannerLines(state);
                break;
            case "gameOver":
                label.foreground = GAME_OVER_COLOR;
                label.image = gameOverLines(state);
                break;
            case "none":
                label.image = NO_TEXT;
                break;
        }
    }

    private bannerOf(state: SwarmState): BannerKind {
        if (state.phase === SwarmPhase.Title) return "title";
        if (state.phase === SwarmPhase.GameOver) return "gameOver";
        if (state.phase === SwarmPhase.Playing && state.intermissionRemainingMs > 0) return "wave";
        return "none";
    }
}

export function setupSwarm(world: World, host: SwarmHost): void {
    const buffer = commandBufferOf(world);
    world.resources.insert(new SwarmHostResource(host));
    world.resources.insert(new SwarmState());
    world.resources.insert(new SeededRandom(host.seed));
    world.resources.insert(new EnemyGrid());
    world.resources.getOrCreate(Input).bindActions(SWARM_ACTIONS);

    buffer.createEntity("camera", [new Camera(), new LocalPosition(), new LocalToWorld()]);
    buffer.createEntity("ship", [new Ship(), new Sprite(SHIP_IMAGE), new LocalPosition(0, 0, SHIP_DEPTH), new LocalToWorld()]);
    const labels = new SwarmHudLabels(
        createHudLabel(buffer, "swarmStatus", BLANK_LINE, STATUS_COLOR, "top-left"),
        createHudLabel(buffer, "swarmStats", BLANK_LINE, STATS_COLOR, "top-right"),
        createHudLabel(buffer, "swarmBanner", BLANK_LINE, TITLE_COLOR, "middle-center"),
    );
    labels.status.background = HUD_BACKGROUND;
    labels.stats.background = HUD_BACKGROUND;
    labels.banner.background = HUD_BACKGROUND;
    world.resources.insert(labels);

    world.ensureSystemExists(SwarmArenaSystem);
    world.ensureSystemExists(SwarmControlSystem);
    world.ensureSystemExists(ShipSystem);
    world.ensureSystemExists(ShipWeaponSystem);
    world.ensureSystemExists(WaveSystem);
    world.ensureSystemExists(EnemySeekSystem);
    world.ensureSystemExists(MotionSystem);
    world.ensureSystemExists(LifetimeSystem);
    world.ensureSystemExists(EnemyBroadphaseSystem);
    world.ensureSystemExists(BulletHitSystem);
    world.ensureSystemExists(BombSystem);
    world.ensureSystemExists(ShipContactSystem);
    world.ensureSystemExists(SwarmHudSystem);
}
