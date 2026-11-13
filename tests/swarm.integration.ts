import {DebugWorld, EntityQuery} from "../src/engine/core";
import {MemoryPlatform, MemoryTerminal} from "../src/engine/testing/memoryPlatform";
import {Input, Key, NO_MODIFIERS} from "../src/engine/input";
import {consoleOverride} from "../src/engine/debugging";
import {originalConsole} from "../src/engine/debugging/originalConsole";
import {GREEN_SHIFT, RED_SHIFT, SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../src/engine/rendering";
import {LocalPosition} from "../src/engine/translation";
import {CellPresenterResource} from "../src/backends/cells";
import {MemoryPixelPresenter, PixelPresenterResource, RGBA_BYTES_PER_PIXEL} from "../src/backends/pixels";
import type {PixelFrame, PixelPresenterSize} from "../src/backends/pixels";
import {AnsiCellPresenter} from "../src/hosts/terminal";
import {TerminalScreen} from "./support/terminalScreen";
import {setupSwarm} from "../demo/swarm/game";
import {Bullet, Enemy, Spark} from "../demo/swarm/components";
import {SwarmPhase, SwarmState} from "../demo/swarm/resources";
import {
    BOMB_RADIUS_UNITS,
    enemyCountForWave,
    SHIP_RADIUS_UNITS,
    START_BOMBS,
    START_LIVES,
    SWARMER_RGB,
} from "../demo/swarm/tuning";
import {installCellRenderingSwarm} from "../demo/swarm/launch/cellRendering";
import {installPixelRenderingSwarm} from "../demo/swarm/launch/pixelRendering";

const SEED = 20261113;
const FRAME_MS = 1000 / 60;
const FRAMES_PER_SECOND = 60;
const TERMINAL_SIZE = {columns: 120, rows: 40};
const PIXEL_SIZE: PixelPresenterSize = {widthPx: 640, heightPx: 384};
const SETTLE_FRAMES = 3;
const START_FRAMES = 2;
const RESTART_FRAMES = 2;
const MAX_WAIT_FRAMES = 90 * FRAMES_PER_SECOND;
const SAFE_LIVES = 99;
const LAST_LIFE = 1;
const ALIGN_TOLERANCE_UNITS = 1;
const MIN_BOMB_TARGETS = 3;
const SECOND_WAVE = 2;
const PERF_WAVE = 10;
const PERF_MIN_WAVE_ENEMIES = 2000;
const PERF_SPAWNED_FRACTION_BEFORE_MEASURING = 0.6;
const PERF_MEASURED_FRAMES = 120;
const PERF_MIN_ENEMIES_ALIVE = 1000;
const WAVE_10_STEP_BUDGET_MS = 50;
const MS_DECIMALS = 2;
const HALF = 0.5;
const OCTANTS = 8;
const OCTANT_RAD = Math.PI / 4;
const BACKGROUND_RGB = 0x000000;
const HUD_BAND_PX = 16;
const KEEP_LAST_FRAME = 1;
const NO_KEYS: readonly Key[] = [];

const FIRE_KEYS_BY_OCTANT: readonly (readonly Key[])[] = [
    [Key.Right], [Key.Right, Key.Down], [Key.Down], [Key.Left, Key.Down],
    [Key.Left], [Key.Left, Key.Up], [Key.Up], [Key.Right, Key.Up],
];
const MOVE_KEYS_BY_OCTANT: readonly (readonly Key[])[] = [
    [Key.D], [Key.D, Key.S], [Key.S], [Key.A, Key.S],
    [Key.A], [Key.A, Key.W], [Key.W], [Key.D, Key.W],
];

function log(message: string) {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string) {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

const errors: string[] = [];
const errorRecorder: Console = Object.create(originalConsole);
errorRecorder.error = (...data: unknown[]) => errors.push(data.map(String).join(" "));
consoleOverride.addConsoleEventListener(errorRecorder);

function octantOf(dx: number, dy: number): number {
    return ((Math.round(Math.atan2(dy, dx) / OCTANT_RAD) % OCTANTS) + OCTANTS) % OCTANTS;
}

interface EnemyOffset {
    readonly dx: number;
    readonly dy: number;
    readonly distance: number;
    readonly radius: number;
}

function swarmQueries(world: DebugWorld) {
    return {
        enemies: new EntityQuery(world, [Enemy, LocalPosition]),
        bullets: new EntityQuery(world, [Bullet]),
        sparks: new EntityQuery(world, [Spark]),
    };
}

class SwarmDriver {
    public readonly input: Input;
    public readonly state: SwarmState;
    private readonly queries: ReturnType<typeof swarmQueries>;
    private held = new Set<Key>();

    public constructor(private readonly world: DebugWorld, private readonly afterStep: () => void) {
        this.input = world.resources.getOrCreate(Input);
        this.state = world.resources.get(SwarmState);
        this.queries = swarmQueries(world);
    }

    public step(frames: number = 1): void {
        for (let frame = 0; frame < frames; frame++) {
            this.world.step(FRAME_MS);
            this.afterStep();
        }
    }

    public runUntil(done: () => boolean, beforeEachStep: () => void, afterEachStep: () => void = () => undefined): boolean {
        for (let frame = 0; frame < MAX_WAIT_FRAMES; frame++) {
            if (done()) return true;
            beforeEachStep();
            this.step();
            afterEachStep();
        }
        return done();
    }

    public tap(key: Key): void {
        this.input.enqueue({type: "keyDown", key, repeat: false, ...NO_MODIFIERS});
        this.input.enqueue({type: "keyUp", key, ...NO_MODIFIERS});
    }

    public hold(keys: readonly Key[]): void {
        const next = new Set(keys);
        for (const key of this.held) if (!next.has(key)) this.input.enqueue({type: "keyUp", key, ...NO_MODIFIERS});
        for (const key of next) if (!this.held.has(key)) this.input.enqueue({type: "keyDown", key, repeat: false, ...NO_MODIFIERS});
        this.held = next;
    }

    public enemyCount(): number {
        return this.queries.enemies.enabledEntityCount();
    }

    public bulletCount(): number {
        return this.queries.bullets.enabledEntityCount();
    }

    public sparkCount(): number {
        return this.queries.sparks.enabledEntityCount();
    }

    public enemyOffsets(): EnemyOffset[] {
        const shipX = this.state.shipX, shipY = this.state.shipY * SCREEN_UNIT_HEIGHT_PER_WIDTH;
        const offsets: EnemyOffset[] = [];
        this.queries.enemies.stream({read: {enemy: Enemy, position: LocalPosition}}).forEach(({enemy, position}) => {
            if (enemy.hitPoints <= 0) return;
            const dx = position.x - shipX, dy = position.y * SCREEN_UNIT_HEIGHT_PER_WIDTH - shipY;
            offsets.push({dx, dy, distance: Math.hypot(dx, dy), radius: enemy.kind.radiusUnits});
        });
        return offsets;
    }

    public nearestEnemy(): EnemyOffset | undefined {
        let nearest: EnemyOffset | undefined;
        for (const offset of this.enemyOffsets()) if (nearest === undefined || offset.distance < nearest.distance) nearest = offset;
        return nearest;
    }

    public enemiesWithin(radius: number): number {
        return this.enemyOffsets().filter(offset => offset.distance < radius).length;
    }

    public enemiesTouchingShip(): number {
        return this.enemyOffsets().filter(offset => offset.distance <= SHIP_RADIUS_UNITS + offset.radius).length;
    }

    public aimAtNearest(): void {
        const target = this.nearestEnemy();
        if (target === undefined) {
            this.hold(NO_KEYS);
            return;
        }
        const octant = octantOf(target.dx, target.dy);
        const directionX = Math.cos(octant * OCTANT_RAD), directionY = Math.sin(octant * OCTANT_RAD);
        const along = target.dx * directionX + target.dy * directionY;
        const offAxisX = target.dx - along * directionX, offAxisY = target.dy - along * directionY;
        const keys = [...FIRE_KEYS_BY_OCTANT[octant]];
        if (Math.hypot(offAxisX, offAxisY) > ALIGN_TOLERANCE_UNITS) keys.push(...MOVE_KEYS_BY_OCTANT[octantOf(offAxisX, offAxisY)]);
        this.hold(keys);
    }

    public ramNearest(): void {
        const target = this.nearestEnemy();
        this.hold(target === undefined ? NO_KEYS : MOVE_KEYS_BY_OCTANT[octantOf(target.dx, target.dy)]);
    }
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * HALF)];
}

function runOnCells(): void {
    log("--- Swarm on cells");
    const terminal = new MemoryTerminal(TERMINAL_SIZE);
    const screen = new TerminalScreen(TERMINAL_SIZE.columns, TERMINAL_SIZE.rows);
    const world = new DebugWorld({platform: new MemoryPlatform()});
    world.resources.insert(new CellPresenterResource(new AnsiCellPresenter(terminal)));
    let quits = 0;
    setupSwarm(world, {render: installCellRenderingSwarm(world), seed: SEED, quit: () => quits++});
    const driver = new SwarmDriver(world, () => {
        screen.write(terminal.text());
        terminal.clear();
    });
    const state = driver.state;

    driver.step(SETTLE_FRAMES);
    expect(state.phase === SwarmPhase.Title, "the game opens on the title screen");
    expect(screen.text().includes("press ENTER to start"), "the title screen is drawn as HUD text");

    driver.tap(Key.Enter);
    driver.step(START_FRAMES);
    expect(state.phase === SwarmPhase.Playing, `Enter starts a game (${state.phase})`);
    expect(state.score === 0 && state.wave === 1 && state.lives === START_LIVES && state.bombs === START_BOMBS,
        `a new game starts at score 0, wave 1, ${START_LIVES} lives, ${START_BOMBS} bombs`);
    expect(screen.text().includes(`SCORE 0   WAVE 1   LIVES ${START_LIVES}   BOMBS ${START_BOMBS}`), "the HUD shows score, wave, lives and bombs");
    expect(screen.text().includes("W A V E   1"), "the wave banner shows before the first wave");

    const hit = driver.runUntil(() => state.lives < START_LIVES, () => driver.hold(NO_KEYS));
    expect(hit && state.lives === START_LIVES - 1, `enemy contact costs one life (${state.lives} left)`);
    expect(state.invulnerableRemainingMs > 0, "losing a life makes the ship invulnerable");
    let overlapsWhileInvulnerable = 0;
    driver.runUntil(() => state.invulnerableRemainingMs <= FRAME_MS, () => driver.ramNearest(), () => {
        if (driver.enemiesTouchingShip() > 0) overlapsWhileInvulnerable++;
    });
    driver.hold(NO_KEYS);
    expect(overlapsWhileInvulnerable > 0, `the invulnerable ship rammed enemies (${overlapsWhileInvulnerable} frames touching)`);
    expect(state.lives === START_LIVES - 1, `invulnerability prevented further hits (${state.lives} lives)`);

    state.lives = SAFE_LIVES;
    const killsBeforeFiring = state.kills, scoreBeforeFiring = state.score;
    let bulletsSeen = 0;
    const killed = driver.runUntil(() => state.kills > killsBeforeFiring, () => driver.aimAtNearest(), () => {
        bulletsSeen = Math.max(bulletsSeen, driver.bulletCount());
    });
    expect(bulletsSeen > 0, `holding an arrow fires bullets (up to ${bulletsSeen} in flight)`);
    expect(killed && state.score > scoreBeforeFiring, `firing kills enemies and the score rises (${state.kills} kills, score ${state.score})`);

    const cleared = driver.runUntil(() => state.wave === SECOND_WAVE, () => driver.aimAtNearest());
    driver.hold(NO_KEYS);
    expect(cleared && driver.enemyCount() === 0, `clearing wave 1 advances to wave ${state.wave}`);
    driver.step();
    expect(screen.text().includes(`W A V E   ${SECOND_WAVE}`), "the wave banner announces the next wave");

    const gathered = driver.runUntil(() => driver.enemiesWithin(BOMB_RADIUS_UNITS) >= MIN_BOMB_TARGETS, () => driver.hold(NO_KEYS));
    const bombsBefore = state.bombs, killsBefore = state.kills, near = driver.enemiesWithin(BOMB_RADIUS_UNITS);
    driver.tap(Key.Space);
    driver.step();
    expect(gathered, `enemies gathered within the bomb radius (${near})`);
    expect(state.bombs === bombsBefore - 1, `the bomb used a charge (${bombsBefore} -> ${state.bombs})`);
    expect(driver.enemiesWithin(BOMB_RADIUS_UNITS) === 0 && state.kills >= killsBefore + near,
        `the bomb cleared every enemy within its radius (${state.kills - killsBefore} killed)`);
    expect(driver.sparkCount() > 0, `the bomb burst into fading sparks (${driver.sparkCount()})`);

    state.lives = LAST_LIFE;
    const over = driver.runUntil(() => state.phase === SwarmPhase.GameOver, () => driver.hold(NO_KEYS));
    driver.step();
    expect(over && state.lives === 0, "losing the last life ends the game");
    expect(screen.text().includes("GAME OVER") && screen.text().includes("press R to restart"), "the game over screen is drawn as HUD text");

    driver.tap(Key.R);
    driver.step(RESTART_FRAMES);
    expect(state.phase === SwarmPhase.Playing, `R restarts (${state.phase})`);
    expect(state.score === 0 && state.kills === 0 && state.wave === 1 && state.lives === START_LIVES && state.bombs === START_BOMBS,
        "the restarted game has fresh state");
    expect(driver.enemyCount() === 0 && driver.bulletCount() === 0 && driver.sparkCount() === 0,
        "restarting cleared every enemy, bullet and spark");

    expect(enemyCountForWave(PERF_WAVE) >= PERF_MIN_WAVE_ENEMIES, `wave ${PERF_WAVE} sends ${enemyCountForWave(PERF_WAVE)} enemies`);
    state.wave = PERF_WAVE;
    state.lives = SAFE_LIVES;
    driver.runUntil(() => state.waveEnemyTarget > 0 && state.waveEnemiesSpawned >= state.waveEnemyTarget * PERF_SPAWNED_FRACTION_BEFORE_MEASURING,
        () => driver.hold([Key.Right, Key.Up]));
    const stepTimesMs: number[] = [];
    for (let frame = 0; frame < PERF_MEASURED_FRAMES; frame++) {
        const started = performance.now();
        world.step(FRAME_MS);
        stepTimesMs.push(performance.now() - started);
        screen.write(terminal.text());
        terminal.clear();
    }
    const alive = driver.enemyCount();
    const meanMs = stepTimesMs.reduce((sum, value) => sum + value, 0) / stepTimesMs.length;
    const medianMs = median(stepTimesMs);
    log(`wave ${state.wave}: ${alive} enemies alive, ${world.enabledEntityCount} entities; step median ${medianMs.toFixed(MS_DECIMALS)} ms, `
        + `mean ${meanMs.toFixed(MS_DECIMALS)} ms, max ${Math.max(...stepTimesMs).toFixed(MS_DECIMALS)} ms (budget ${WAVE_10_STEP_BUDGET_MS} ms)`);
    expect(state.wave === PERF_WAVE && alive >= PERF_MIN_ENEMIES_ALIVE, `wave ${PERF_WAVE} fields thousands of enemies (${alive} alive)`);
    expect(medianMs < WAVE_10_STEP_BUDGET_MS, `a wave ${PERF_WAVE} step stays under ${WAVE_10_STEP_BUDGET_MS} ms (median ${medianMs.toFixed(MS_DECIMALS)} ms)`);
    expect(screen.text().includes(`WAVE ${PERF_WAVE}`) && screen.text().includes("FPS"), "the HUD shows the wave and FPS during the swarm");

    driver.hold(NO_KEYS);
    driver.tap(Key.Escape);
    driver.step();
    expect(quits === 1, "Esc stops the world and asks the host to quit");
}

function rgbAt(frame: PixelFrame, index: number): number {
    const i = index * RGBA_BYTES_PER_PIXEL;
    return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
}

function pixelsMatching(frame: PixelFrame, firstRow: number, lastRow: number, matches: (rgb: number) => boolean): number {
    let count = 0;
    for (let index = firstRow * frame.widthPx; index < lastRow * frame.widthPx; index++) if (matches(rgbAt(frame, index))) count++;
    return count;
}

function runOnPixels(): void {
    log("--- Swarm on pixels");
    const presenter = new MemoryPixelPresenter(PIXEL_SIZE);
    const world = new DebugWorld({platform: new MemoryPlatform()});
    world.resources.insert(new PixelPresenterResource(presenter));
    let quits = 0;
    setupSwarm(world, {render: installPixelRenderingSwarm(world), seed: SEED, quit: () => quits++});
    const driver = new SwarmDriver(world, () => presenter.frames.splice(0, presenter.frames.length - KEEP_LAST_FRAME));
    const isPainted = (rgb: number) => rgb !== BACKGROUND_RGB;
    const isSwarmer = (rgb: number) => rgb === SWARMER_RGB;

    driver.step(SETTLE_FRAMES);
    const title = presenter.lastFrame!;
    expect(title.widthPx === PIXEL_SIZE.widthPx && title.heightPx === PIXEL_SIZE.heightPx, "the pixel frame has the presenter's size");
    expect(pixelsMatching(title, 0, title.heightPx, isPainted) > 0, "the title screen paints pixels");

    driver.tap(Key.Enter);
    const swarmersVisible = driver.runUntil(() => pixelsMatching(presenter.lastFrame!, 0, PIXEL_SIZE.heightPx, isSwarmer) > 0, () => driver.hold(NO_KEYS));
    const playing = presenter.lastFrame!;
    expect(swarmersVisible, `swarmers are drawn in their colour (${pixelsMatching(playing, 0, playing.heightPx, isSwarmer)} px)`);
    expect(pixelsMatching(playing, 0, HUD_BAND_PX, isPainted) > 0, "the HUD text paints the top band");
    expect(pixelsMatching(playing, HUD_BAND_PX, playing.heightPx, isPainted) > 0, "the playfield paints non-background pixels");

    driver.tap(Key.Escape);
    driver.step();
    expect(quits === 1, "Esc quits on pixels too");
}

runOnCells();
runOnPixels();
expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);
consoleOverride.removeConsoleEventListener(errorRecorder);

if (failures > 0) {
    console.error(`${failures} swarm integration failures`);
    process.exit(1);
}
log("swarm integration test OK");
