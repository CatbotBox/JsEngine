import {createHash} from "crypto";
import {App, EntityQuery} from "../src/engine/core";
import type {DebugWorld, Entity} from "../src/engine/core";
import {MemoryPlatform, MemoryTerminal} from "../src/engine/testing/memoryPlatform";
import {Input, Key, NO_MODIFIERS, PointerButton} from "../src/engine/input";
import type {Modifiers} from "../src/engine/input";
import {consoleOverride} from "../src/engine/debugging";
import {originalConsole} from "../src/engine/debugging/originalConsole";
import {Parent} from "../src/engine/translation";
import {UiRect, UiRoot, UiScaleSnapping, UiScroll, UiText} from "../src/engine/ui";
import {MemoryPixelPresenter} from "../src/backends/pixels";
import type {PixelPresenterSize} from "../src/backends/pixels";
import {AnsiCellPresenter, nodePlatform} from "../src/hosts/terminal";
import {TerminalScreen} from "./support/terminalScreen";
import {startCellsDemo, startPixelsDemo, SWARM_PROJECT} from "./support/demoProjects";
import {seededSwarmFiles} from "./support/demoFrameHashLaunch";
import {pendingWorkSettled} from "./support/demoFrameHashScripts";
import {SwarmSetting, SwarmSettingAction, SwarmSettingButton, SwarmSettingsMenu, SwarmSettingValue} from "../demo/swarm/components";
import {SwarmConfig} from "../demo/swarm/config";
import {SwarmPhase, SwarmState} from "../demo/swarm/resources";
import {roundToDecimals} from "../demo/swarm/settingPath";

const SEED = 20261113;
const FRAME_MS = 1000 / 60;
const TERMINAL_SIZE = {columns: 120, rows: 40};
const PIXEL_SIZE: PixelPresenterSize = {widthPx: 640, heightPx: 384};
const SETTLE_FRAMES = 3;
const KEEP_LAST_FRAME = 1;
const HALF = 0.5;
const WHEEL_DOWN = -1;
const MAX_WHEEL_NOTCHES = 20;
const LIVES_FIELD = "ship.startLives";
const SEED_FIELD = "randomSeed";
const JITTER_FIELD = "waves.enemySpeedJitterFraction";
const LIVES_LABEL = "start lives";
const MENU_TITLE = "S E T T I N G S";
const TITLE_BUTTON_TEXT = "SETTINGS";
const ADDED_LIVES = 2;
const SINGLE_MENU = 1;
const SHOWN_ON = "ON";
const SHOWN_OFF = "OFF";
const QUIT_ONCE = 1;
const CTRL: Modifiers = {...NO_MODIFIERS, ctrl: true};

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

interface DrivenBackend {
    readonly label: string;
    readonly world: DebugWorld;
    readonly platform: MemoryPlatform;
    readonly afterStep: () => void;
    frameDigest(): string;
    screenText(): string | undefined;
}

interface PointerPosition {
    readonly x: number;
    readonly y: number;
}

interface WatchedValues {
    readonly startLives: number;
    readonly jitter: number;
    readonly randomSeed: number | undefined;
}

class SettingsDriver {
    private readonly input: Input;
    private readonly menus: EntityQuery<[typeof SwarmSettingsMenu]>;
    private readonly buttons: EntityQuery<[typeof SwarmSettingButton]>;
    private readonly values: EntityQuery<[typeof SwarmSettingValue]>;
    private readonly settings: EntityQuery<[typeof SwarmSetting]>;
    private readonly scrolls: EntityQuery<[typeof UiScroll]>;

    public constructor(private readonly backend: DrivenBackend) {
        const world = backend.world;
        this.input = world.resources.getOrCreate(Input);
        this.menus = new EntityQuery(world, [SwarmSettingsMenu]);
        this.buttons = new EntityQuery(world, [SwarmSettingButton]);
        this.values = new EntityQuery(world, [SwarmSettingValue]);
        this.settings = new EntityQuery(world, [SwarmSetting]);
        this.scrolls = new EntityQuery(world, [UiScroll]);
    }

    public get world(): DebugWorld {
        return this.backend.world;
    }

    public step(frames: number = 1): void {
        for (let frame = 0; frame < frames; frame++) {
            this.world.step(FRAME_MS);
            this.backend.afterStep();
        }
    }

    public tap(key: Key, modifiers: Modifiers = NO_MODIFIERS): void {
        this.input.enqueue({type: "keyDown", key, repeat: false, ...modifiers});
        this.input.enqueue({type: "keyUp", key, ...modifiers});
        this.step(SETTLE_FRAMES);
    }

    public menuOpen(): boolean {
        return this.menus.hasEntity();
    }

    public menuCount(): number {
        return this.menus.enabledEntityCount();
    }

    public click(entity: Entity): void {
        const {x, y} = this.pointerAt(entity);
        this.input.enqueue({type: "pointerMove", x, y, ...NO_MODIFIERS});
        this.input.enqueue({type: "pointerDown", button: PointerButton.Left, x, y, ...NO_MODIFIERS});
        this.step();
        this.input.enqueue({type: "pointerUp", button: PointerButton.Left, x, y, ...NO_MODIFIERS});
        this.step(SETTLE_FRAMES);
    }

    public wheelOver(entity: Entity, delta: number): void {
        const {x, y} = this.pointerAt(entity);
        this.input.enqueue({type: "wheel", delta, x, y, ...NO_MODIFIERS});
        this.step();
    }

    public button(action: SwarmSettingAction, field?: string): Entity {
        const found: Entity[] = [];
        this.buttons.stream({read: {button: SwarmSettingButton}}, {includeEntity: true}).forEach(({entity, button}) => {
            if (button.action === action && (field === undefined || this.settingOf(entity)?.field === field)) found.push(entity);
        });
        if (found.length !== 1) throw new Error(`expected one ${action} button${field === undefined ? "" : ` for ${field}`}, found ${found.length}`);
        return found[0];
    }

    public row(field: string): Entity {
        const found: Entity[] = [];
        this.settings.stream({read: {setting: SwarmSetting}}, {includeEntity: true}).forEach(({entity, setting}) => {
            if (setting.field === field) found.push(entity);
        });
        if (found.length !== 1) throw new Error(`expected one ${field} row, found ${found.length}`);
        return found[0];
    }

    public scrollRegion(): Entity {
        const found: Entity[] = [];
        this.scrolls.stream({read: {scroll: UiScroll}}, {includeEntity: true}).forEach(({entity}) => found.push(entity));
        if (found.length !== 1) throw new Error(`expected one scroll region, found ${found.length}`);
        return found[0];
    }

    public lastRow(): Entity {
        let last: Entity | undefined;
        this.settings.stream({read: {setting: SwarmSetting}}, {includeEntity: true}).forEach(({entity}) => {
            if (last === undefined || this.rectOf(entity).y > this.rectOf(last).y) last = entity;
        });
        if (last === undefined) throw new Error("the settings menu has no rows");
        return last;
    }

    public shownValue(field: string): string {
        let shown: string | undefined;
        this.values.stream({read: {value: SwarmSettingValue}}, {includeEntity: true}).forEach(({entity}) => {
            if (this.settingOf(entity)?.field === field) shown = this.world.entityManager.getComponent<UiText>(entity, UiText)?.text;
        });
        if (shown === undefined) throw new Error(`no value text for ${field}`);
        return shown;
    }

    public fullyVisible(entity: Entity): boolean {
        const rect = this.rectOf(entity);
        return rect.y >= rect.clipTop && rect.y + rect.height <= rect.clipBottom && rect.height > 0;
    }

    public settingOf(entity: Entity): SwarmSetting | undefined {
        const entityManager = this.world.entityManager;
        for (let node: Entity | undefined = entity; node !== undefined; node = entityManager.getComponent<Parent>(node, Parent)?.entity) {
            const setting = entityManager.getComponent<SwarmSetting>(node, SwarmSetting);
            if (setting !== undefined) return setting;
        }
        return undefined;
    }

    private rectOf(entity: Entity): UiRect {
        const rect = this.world.entityManager.getComponent<UiRect>(entity, UiRect);
        if (rect === undefined) throw new Error(`${this.world.entityManager.nameOf(entity)} has no UiRect`);
        return rect;
    }

    private rootScaleOf(entity: Entity): number {
        const entityManager = this.world.entityManager;
        for (let node: Entity | undefined = entity; node !== undefined; node = entityManager.getComponent<Parent>(node, Parent)?.entity) {
            const root = entityManager.getComponent<UiRoot>(node, UiRoot);
            if (root !== undefined) return this.world.resources.get(UiScaleSnapping).effectiveScale(root.scale);
        }
        throw new Error(`${entityManager.nameOf(entity)} is under no UiRoot`);
    }

    private pointerAt(entity: Entity): PointerPosition {
        const rect = this.rectOf(entity), scale = this.rootScaleOf(entity);
        const left = Math.max(rect.x, rect.clipLeft), right = Math.min(rect.x + rect.width, rect.clipRight);
        const top = Math.max(rect.y, rect.clipTop), bottom = Math.min(rect.y + rect.height, rect.clipBottom);
        return {x: (left + right) * HALF * scale, y: (top + bottom) * HALF * scale};
    }
}

function watchedValues(config: SwarmConfig): WatchedValues {
    return {startLives: config.ship.startLives, jitter: config.waves.enemySpeedJitterFraction, randomSeed: config.randomSeed};
}

function screenLineWith(text: string | undefined, label: string): string {
    return text?.split("\n").find(line => line.includes(label)) ?? "";
}

function projectPlatform(): MemoryPlatform {
    return new MemoryPlatform({fileSource: seededSwarmFiles(nodePlatform().files, SEED)});
}

async function exercise(backend: DrivenBackend): Promise<void> {
    const driver = new SettingsDriver(backend);
    const world = backend.world;
    const config = world.resources.get(SwarmConfig);
    const state = world.resources.get(SwarmState);
    const original = watchedValues(config);
    const isCells = backend.screenText() !== undefined;

    driver.step(SETTLE_FRAMES);
    expect(state.phase === SwarmPhase.Title && !driver.menuOpen(), `${backend.label}: the title screen opens with the menu closed`);
    if (isCells) expect(backend.screenText()!.includes(TITLE_BUTTON_TEXT), `${backend.label}: the title screen draws the SETTINGS button`);

    const titleDigest = backend.frameDigest();
    driver.tap(Key.O);
    expect(driver.menuOpen(), `${backend.label}: O opens the settings menu`);
    expect(backend.frameDigest() !== titleDigest, `${backend.label}: the open menu changes the frame`);
    if (isCells) expect(backend.screenText()!.includes(MENU_TITLE), `${backend.label}: the menu draws its title`);
    driver.tap(Key.O);
    expect(!driver.menuOpen(), `${backend.label}: O closes the settings menu`);

    driver.tap(Key.O);
    driver.click(driver.button(SwarmSettingAction.Close));
    expect(!driver.menuOpen(), `${backend.label}: CLOSE closes the settings menu`);

    driver.click(driver.button(SwarmSettingAction.Open));
    expect(driver.menuOpen(), `${backend.label}: clicking the title SETTINGS button opens the menu`);
    driver.click(driver.button(SwarmSettingAction.Open));
    expect(driver.menuCount() === SINGLE_MENU, `${backend.label}: only one menu opens at a time`);

    const beforeLives = backend.frameDigest();
    driver.click(driver.button(SwarmSettingAction.Increase, LIVES_FIELD));
    const livesShown = String(original.startLives + 1);
    expect(config.ship.startLives === original.startLives + 1, `${backend.label}: + raises SwarmConfig.ship.startLives (${original.startLives} -> ${config.ship.startLives})`);
    expect(driver.shownValue(LIVES_FIELD) === livesShown, `${backend.label}: the lives row shows ${livesShown} (${driver.shownValue(LIVES_FIELD)})`);
    expect(backend.frameDigest() !== beforeLives, `${backend.label}: the frame changes after +`);
    if (isCells) {
        const line = screenLineWith(backend.screenText(), LIVES_LABEL);
        expect(new RegExp(`${LIVES_LABEL}\\s+${livesShown}\\s`).test(line), `${backend.label}: the drawn lives row reads ${livesShown} ("${line.trim()}")`);
    }

    driver.click(driver.button(SwarmSettingAction.Toggle, SEED_FIELD));
    const toggledOnce = config.randomSeed;
    driver.click(driver.button(SwarmSettingAction.Toggle, SEED_FIELD));
    const toggledTwice = config.randomSeed;
    expect(toggledOnce === undefined && toggledTwice === driver.settingOf(driver.row(SEED_FIELD))!.toggledOnValue,
        `${backend.label}: the fixed seed toggle flips randomSeed off and back on (${original.randomSeed} -> ${toggledOnce} -> ${toggledTwice})`);
    driver.click(driver.button(SwarmSettingAction.Toggle, SEED_FIELD));
    expect(driver.shownValue(SEED_FIELD) === SHOWN_OFF, `${backend.label}: the seed row shows OFF (${driver.shownValue(SEED_FIELD)})`);

    const lastRow = driver.lastRow();
    const lastSetting = driver.settingOf(lastRow)!;
    expect(lastSetting.field === JITTER_FIELD, `${backend.label}: the last row is ${JITTER_FIELD} (${lastSetting.field})`);
    expect(!driver.fullyVisible(lastRow), `${backend.label}: the last row starts scrolled out of view`);
    const scrollRegion = driver.scrollRegion();
    for (let notch = 0; notch < MAX_WHEEL_NOTCHES && !driver.fullyVisible(lastRow); notch++) driver.wheelOver(scrollRegion, WHEEL_DOWN);
    expect(driver.fullyVisible(lastRow), `${backend.label}: wheeling over the rows scrolls the last row into view`);
    driver.click(driver.button(SwarmSettingAction.Decrease, JITTER_FIELD));
    const loweredJitter = roundToDecimals(original.jitter - lastSetting.step, lastSetting.decimals);
    expect(config.waves.enemySpeedJitterFraction === loweredJitter,
        `${backend.label}: - on the last row lowers the jitter by one step (${original.jitter} -> ${config.waves.enemySpeedJitterFraction})`);
    expect(driver.shownValue(JITTER_FIELD) === loweredJitter.toFixed(lastSetting.decimals), `${backend.label}: the jitter row shows ${driver.shownValue(JITTER_FIELD)}`);

    driver.click(driver.button(SwarmSettingAction.Reset));
    const reset = watchedValues(config);
    expect(reset.startLives === original.startLives && reset.jitter === original.jitter && reset.randomSeed === original.randomSeed,
        `${backend.label}: RESET restores the asset values (lives ${reset.startLives}, jitter ${reset.jitter}, seed ${reset.randomSeed})`);
    expect(driver.shownValue(LIVES_FIELD) === String(original.startLives) && driver.shownValue(SEED_FIELD) === SHOWN_ON,
        `${backend.label}: RESET refreshes the shown values (${driver.shownValue(LIVES_FIELD)}, ${driver.shownValue(SEED_FIELD)})`);

    driver.tap(Key.Enter);
    await pendingWorkSettled();
    driver.step(SETTLE_FRAMES);
    expect(state.phase === SwarmPhase.Title && driver.menuOpen(), `${backend.label}: Enter while the menu is open does not start a game (${state.phase})`);

    driver.tap(Key.Escape);
    expect(!driver.menuOpen() && backend.platform.quitCount === 0, `${backend.label}: Esc closes the menu instead of quitting (quits ${backend.platform.quitCount})`);

    driver.tap(Key.O);
    for (let added = 0; added < ADDED_LIVES; added++) driver.click(driver.button(SwarmSettingAction.Increase, LIVES_FIELD));
    driver.tap(Key.O);
    const changedLives = original.startLives + ADDED_LIVES;
    expect(!driver.menuOpen() && config.ship.startLives === changedLives, `${backend.label}: the changed lives outlive closing the menu (${config.ship.startLives})`);

    driver.tap(Key.Enter);
    await pendingWorkSettled();
    driver.step(SETTLE_FRAMES);
    expect(state.phase === SwarmPhase.Playing && state.lives === changedLives, `${backend.label}: Enter starts a game with the changed lives (${state.phase}, ${state.lives} lives)`);

    driver.tap(Key.Escape);
    expect(backend.platform.quitCount === QUIT_ONCE, `${backend.label}: Esc quits once the menu is closed`);
}

async function runOnCells(): Promise<void> {
    log("--- Swarm settings on cells");
    const terminal = new MemoryTerminal(TERMINAL_SIZE);
    const screen = new TerminalScreen(TERMINAL_SIZE.columns, TERMINAL_SIZE.rows);
    const platform = projectPlatform();
    const world = new App({platform}).createDebugWorld();
    await startCellsDemo(world, new AnsiCellPresenter(terminal), SWARM_PROJECT);
    await exercise({
        label: "cells",
        world,
        platform,
        afterStep: () => {
            screen.write(terminal.text());
            terminal.clear();
        },
        frameDigest: () => screen.text(),
        screenText: () => screen.text(),
    });
}

async function runOnPixels(): Promise<void> {
    log("--- Swarm settings on pixels");
    const presenter = new MemoryPixelPresenter(PIXEL_SIZE);
    const platform = projectPlatform();
    const world = new App({platform}).createDebugWorld();
    await startPixelsDemo(world, presenter, SWARM_PROJECT);
    await exercise({
        label: "pixels",
        world,
        platform,
        afterStep: () => presenter.frames.splice(0, presenter.frames.length - KEEP_LAST_FRAME),
        frameDigest: () => createHash("sha1").update(presenter.lastFrame?.rgba ?? new Uint8Array()).digest("hex"),
        screenText: () => undefined,
    });
}

async function runCtrlCQuitsWithMenuOpen(): Promise<void> {
    log("--- Swarm settings: Ctrl+C with the menu open");
    const platform = projectPlatform();
    const world = new App({platform}).createDebugWorld();
    await startCellsDemo(world, new AnsiCellPresenter(new MemoryTerminal(TERMINAL_SIZE)), SWARM_PROJECT);
    const driver = new SettingsDriver({label: "cells", world, platform, afterStep: () => undefined, frameDigest: () => "", screenText: () => undefined});
    driver.step(SETTLE_FRAMES);
    driver.tap(Key.O);
    driver.tap(Key.C, CTRL);
    expect(driver.menuOpen() && platform.quitCount === QUIT_ONCE, `cells: Ctrl+C still quits while the menu is open (quits ${platform.quitCount})`);
}

async function main(): Promise<void> {
    await runOnCells();
    await runCtrlCQuitsWithMenuOpen();
    await runOnPixels();
    expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);
    consoleOverride.removeConsoleEventListener(errorRecorder);

    if (failures > 0) {
        console.error(`${failures} swarm settings integration failures`);
        process.exit(1);
    }
    log("swarm settings integration test OK");
}

void main();
