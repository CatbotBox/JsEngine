import {Key, NO_MODIFIERS, PointerButton} from "../../src/engine/input";
import type {Input, Modifiers} from "../../src/engine/input";
import type {HashedDemo} from "./demoFrameHashLaunch";

export const SHIFT: Modifiers = {...NO_MODIFIERS, shift: true};

export class ScriptedInput {
    private held = new Set<Key>();

    public constructor(private readonly input: Input) {
    }

    public press(key: Key, modifiers: Modifiers = NO_MODIFIERS): void {
        this.input.enqueue({type: "keyDown", key, repeat: false, ...modifiers});
        this.held.add(key);
    }

    public repeat(key: Key, modifiers: Modifiers = NO_MODIFIERS): void {
        this.input.enqueue({type: "keyDown", key, repeat: true, ...modifiers});
    }

    public release(key: Key, modifiers: Modifiers = NO_MODIFIERS): void {
        this.input.enqueue({type: "keyUp", key, ...modifiers});
        this.held.delete(key);
    }

    public tap(key: Key, modifiers: Modifiers = NO_MODIFIERS): void {
        this.press(key, modifiers);
        this.release(key, modifiers);
    }

    public hold(keys: readonly Key[]): void {
        const next = new Set(keys);
        for (const key of [...this.held]) if (!next.has(key)) this.release(key);
        for (const key of next) if (!this.held.has(key)) this.press(key);
    }

    public pointerDown(button: PointerButton, x: number, y: number): void {
        this.input.enqueue({type: "pointerDown", button, x, y, ...NO_MODIFIERS});
    }

    public pointerMove(x: number, y: number): void {
        this.input.enqueue({type: "pointerMove", x, y, ...NO_MODIFIERS});
    }

    public pointerUp(button: PointerButton, x: number, y: number): void {
        this.input.enqueue({type: "pointerUp", button, x, y, ...NO_MODIFIERS});
    }

    public wheel(delta: number, x: number, y: number): void {
        this.input.enqueue({type: "wheel", delta, x, y, ...NO_MODIFIERS});
    }
}

export interface ScriptPhase {
    readonly segment: string;
    readonly ticks: number;
    readonly atStart?: (keys: ScriptedInput) => void;
    readonly eachTick?: (tick: number, keys: ScriptedInput) => void;
    readonly yieldsToPendingWork?: boolean;
}

const NEXT_TASK_DELAY_MS = 0;

export function pendingWorkSettled(): Promise<void> {
    return new Promise(done => setTimeout(done, NEXT_TASK_DELAY_MS));
}

const NO_KEYS: readonly Key[] = [];
const SINGLE_TICK = 1;
const SHORT_PAUSE_TICKS = 3;
const TOGGLE_TICKS = 5;

function tapping(segment: string, key: Key, ticks: number = SHORT_PAUSE_TICKS, modifiers: Modifiers = NO_MODIFIERS): ScriptPhase {
    return {segment, ticks, atStart: keys => keys.tap(key, modifiers)};
}

function pressedWithRepeats(segment: string, key: Key, repeats: number): ScriptPhase[] {
    const phases: ScriptPhase[] = [{segment, ticks: SINGLE_TICK, atStart: keys => keys.press(key)}];
    for (let i = 0; i < repeats; i++) phases.push({segment, ticks: SINGLE_TICK, atStart: keys => keys.repeat(key)});
    phases.push({segment, ticks: SINGLE_TICK, atStart: keys => keys.release(key)});
    return phases;
}

const SWARM_TITLE_TICKS = 3;
const SWARM_START_TICKS = 2;
const SWARM_INTERMISSION_TICKS = 120;
const SWARM_MOVE_STRIDE_TICKS = 20;
const SWARM_FIRE_SWEEP_TICKS = 6;
const SWARM_WAVE_TICKS = 840;
const SWARM_BOMB_TICKS: readonly number[] = [260, 420];
const SWARM_DRIFT_EVERY_TICKS = 90;
const SWARM_DRIFT_TICKS = 12;
const SWARM_LATE_TICKS = 300;
const SWARM_LATE_RESTART_TICK = 200;

const SWARM_MOVE_PATTERN: readonly (readonly Key[])[] = [[Key.D], [Key.D, Key.S], [Key.S], [Key.A], [Key.W, Key.A], NO_KEYS];
const SWARM_DRIFT_PATTERN: readonly (readonly Key[])[] = [[Key.A], [Key.W], [Key.D], [Key.S]];
const SWARM_FIRE_OCTANTS: readonly (readonly Key[])[] = [
    [Key.Right], [Key.Right, Key.Down], [Key.Down], [Key.Left, Key.Down],
    [Key.Left], [Key.Left, Key.Up], [Key.Up], [Key.Right, Key.Up],
];

function cycled<T>(items: readonly T[], tick: number, stride: number): T {
    return items[Math.floor(tick / stride) % items.length];
}

function swarmWaveKeys(tick: number): Key[] {
    const fire = cycled(SWARM_FIRE_OCTANTS, tick, SWARM_FIRE_SWEEP_TICKS);
    const drifting = tick % SWARM_DRIFT_EVERY_TICKS < SWARM_DRIFT_TICKS;
    const drift = drifting ? cycled(SWARM_DRIFT_PATTERN, tick, SWARM_DRIFT_EVERY_TICKS) : NO_KEYS;
    return [...fire, ...drift];
}

const SWARM_SCRIPT: readonly ScriptPhase[] = [
    {segment: "title", ticks: SWARM_TITLE_TICKS},
    tapping("title", Key.Tab, TOGGLE_TICKS),
    tapping("title", Key.Tab, TOGGLE_TICKS),
    {...tapping("start", Key.Enter, SWARM_START_TICKS), yieldsToPendingWork: true},
    {segment: "intermission", ticks: SWARM_INTERMISSION_TICKS, eachTick: (tick, keys) => keys.hold(cycled(SWARM_MOVE_PATTERN, tick, SWARM_MOVE_STRIDE_TICKS))},
    {
        segment: "wave",
        ticks: SWARM_WAVE_TICKS,
        eachTick: (tick, keys) => {
            keys.hold(swarmWaveKeys(tick));
            if (SWARM_BOMB_TICKS.includes(tick)) keys.tap(Key.Space);
        },
    },
    {
        segment: "late",
        ticks: SWARM_LATE_TICKS,
        eachTick: (tick, keys) => {
            keys.hold(swarmWaveKeys(tick));
            if (tick === SWARM_LATE_RESTART_TICK) keys.tap(Key.R);
        },
    },
    {segment: "late", ticks: SINGLE_TICK, atStart: keys => keys.hold(NO_KEYS)},
];

const DEMO_2D_START_TICKS = 4;
const DEMO_2D_ARROW_REPEATS = 2;
const DEMO_2D_CAMERA_REPEATS = 3;
const DEMO_2D_SPAWN_TICKS = 10;
const DEMO_2D_FADE_TICKS = 150;

const DEMO_2D_SCRIPT: readonly ScriptPhase[] = [
    {segment: "start", ticks: DEMO_2D_START_TICKS},
    tapping("spawn", Key.Space, DEMO_2D_SPAWN_TICKS),
    ...pressedWithRepeats("player", Key.Up, DEMO_2D_ARROW_REPEATS),
    tapping("player", Key.Right),
    tapping("player", Key.Down),
    tapping("player", Key.Down),
    tapping("player", Key.Left, SHORT_PAUSE_TICKS, SHIFT),
    ...pressedWithRepeats("camera", Key.W, DEMO_2D_CAMERA_REPEATS),
    tapping("camera", Key.A),
    tapping("camera", Key.S),
    tapping("camera", Key.D, SHORT_PAUSE_TICKS, SHIFT),
    tapping("spawn", Key.Space, DEMO_2D_SPAWN_TICKS),
    tapping("toggles", Key.Backspace, TOGGLE_TICKS),
    tapping("toggles", Key.Backspace, TOGGLE_TICKS),
    tapping("toggles", Key.H, TOGGLE_TICKS),
    tapping("toggles", Key.H, TOGGLE_TICKS),
    tapping("toggles", Key.Tab, TOGGLE_TICKS),
    tapping("toggles", Key.Tab, TOGGLE_TICKS),
    tapping("toggles", Key.Enter, TOGGLE_TICKS),
    tapping("toggles", Key.Enter, TOGGLE_TICKS),
    {segment: "fade", ticks: DEMO_2D_FADE_TICKS},
];

const DEMO_3D_START_TICKS = 4;
const DEMO_3D_ROTATE_REPEATS = 3;
const DEMO_3D_MOVE_REPEATS = 4;
const DEMO_3D_IDLE_TICKS = 20;
const LOOK_START_X = 10, LOOK_START_Y = 10;
const LOOK_MID_X = 14, LOOK_MID_Y = 10;
const LOOK_END_X = 18, LOOK_END_Y = 12;
const WHEEL_AWAY = 1;
const WHEEL_TOWARD = -1;

const DEMO_3D_SCRIPT: readonly ScriptPhase[] = [
    {segment: "start", ticks: DEMO_3D_START_TICKS},
    tapping("spawn", Key.N),
    tapping("spawn", Key.Space),
    tapping("spawn", Key.N),
    tapping("spawn", Key.Space),
    tapping("spawn", Key.Space),
    ...pressedWithRepeats("models", Key.Up, DEMO_3D_ROTATE_REPEATS),
    ...pressedWithRepeats("models", Key.Left, DEMO_3D_ROTATE_REPEATS),
    tapping("models", Key.BracketRight),
    tapping("models", Key.BracketRight),
    tapping("models", Key.BracketLeft),
    ...pressedWithRepeats("camera", Key.W, DEMO_3D_MOVE_REPEATS),
    tapping("camera", Key.A),
    tapping("camera", Key.Q),
    tapping("camera", Key.E, SHORT_PAUSE_TICKS, SHIFT),
    tapping("camera", Key.S),
    tapping("camera", Key.D),
    tapping("camera", Key.Z),
    tapping("camera", Key.X),
    tapping("camera", Key.X),
    {segment: "look", ticks: SINGLE_TICK, atStart: keys => keys.pointerDown(PointerButton.Left, LOOK_START_X, LOOK_START_Y)},
    {segment: "look", ticks: SINGLE_TICK, atStart: keys => keys.pointerMove(LOOK_MID_X, LOOK_MID_Y)},
    {segment: "look", ticks: SINGLE_TICK, atStart: keys => keys.pointerMove(LOOK_END_X, LOOK_END_Y)},
    {segment: "look", ticks: SINGLE_TICK, atStart: keys => keys.pointerUp(PointerButton.Left, LOOK_END_X, LOOK_END_Y)},
    {segment: "look", ticks: SINGLE_TICK, atStart: keys => keys.pointerMove(LOOK_START_X, LOOK_START_Y)},
    {segment: "look", ticks: SINGLE_TICK, atStart: keys => keys.pointerDown(PointerButton.Right, LOOK_START_X, LOOK_START_Y)},
    {segment: "look", ticks: SINGLE_TICK, atStart: keys => keys.pointerMove(LOOK_MID_X, LOOK_MID_Y)},
    {segment: "look", ticks: SINGLE_TICK, atStart: keys => keys.pointerUp(PointerButton.Right, LOOK_MID_X, LOOK_MID_Y)},
    {segment: "look", ticks: SHORT_PAUSE_TICKS, atStart: keys => keys.wheel(WHEEL_AWAY, LOOK_MID_X, LOOK_MID_Y)},
    {segment: "look", ticks: SHORT_PAUSE_TICKS, atStart: keys => keys.wheel(WHEEL_TOWARD, LOOK_MID_X, LOOK_MID_Y)},
    tapping("sun", Key.I),
    tapping("sun", Key.J),
    tapping("sun", Key.K),
    tapping("sun", Key.L),
    tapping("sun", Key.L),
    tapping("render", Key.Num2),
    tapping("render", Key.T),
    tapping("render", Key.F),
    tapping("render", Key.Minus),
    tapping("render", Key.Equal),
    tapping("render", Key.Equal),
    tapping("render", Key.B),
    tapping("render", Key.M),
    tapping("render", Key.O),
    tapping("render", Key.H),
    tapping("render", Key.P),
    tapping("render", Key.H),
    tapping("render", Key.V),
    tapping("render", Key.V),
    tapping("render", Key.Y),
    tapping("render", Key.Num3),
    tapping("render", Key.T),
    tapping("despawn", Key.Backspace),
    tapping("hud", Key.Tab, TOGGLE_TICKS),
    tapping("hud", Key.Tab, TOGGLE_TICKS),
    tapping("reload", Key.R),
    tapping("reload", Key.N),
    tapping("reload", Key.Space),
    {segment: "idle", ticks: DEMO_3D_IDLE_TICKS},
];

export const DEMO_FRAME_HASH_SCRIPTS: Readonly<Record<HashedDemo, readonly ScriptPhase[]>> = {
    "swarm": SWARM_SCRIPT,
    "2d": DEMO_2D_SCRIPT,
    "3d": DEMO_3D_SCRIPT,
};
