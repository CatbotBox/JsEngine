import {AnsiKeyDecoder} from "./ansiKeyDecoder";
import type {DecodedKey} from "./ansiKeyDecoder";
import {Key, keyForCharacter, NO_MODIFIERS, PointerButton} from "../../../engine/input";
import type {CharacterKey, InputEventSink, Modifiers} from "../../../engine/input";
import type {Platform} from "../../../engine/platform";
import type {TerminalInputSource} from "../terminalInputSource";

const CSI = "\x1b[";
const REPORT_ALL_MOTION_MODE = "?1003";
const SGR_EXTENDED_COORDINATES_MODE = "?1006";
const CURSOR_VISIBLE_MODE = "?25";
const ENABLE_MOUSE = `${CSI}${REPORT_ALL_MOTION_MODE}h${CSI}${SGR_EXTENDED_COORDINATES_MODE}h`;
const DISABLE_MOUSE = `${CSI}${REPORT_ALL_MOTION_MODE}l${CSI}${SGR_EXTENDED_COORDINATES_MODE}l`;
const HIDE_CURSOR = `${CSI}${CURSOR_VISIBLE_MODE}l`;
const SHOW_CURSOR = `${CSI}${CURSOR_VISIBLE_MODE}h`;

const DEFAULT_KEY_RELEASE_DELAY_MS = 120;
const MOUSE_BY_DEFAULT = true;
const HIDE_CURSOR_BY_DEFAULT = false;
const NO_TTY_MESSAGE = "[input] no interactive input (stdin is not a TTY) — keyboard/mouse input unavailable.";

const SGR_MOUSE_REPORT = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const SGR_RELEASE_SUFFIX = "m";
const SGR_SHIFT_BIT = 4;
const SGR_META_BIT = 8;
const SGR_CTRL_BIT = 16;
const SGR_MOTION_BIT = 32;
const SGR_WHEEL_BIT = 64;
const SGR_WHEEL_DOWN_BIT = 1;
const SGR_BUTTON_MASK = 3;
const SGR_FIRST_CELL = 1;
const DECIMAL = 10;
const WHEEL_UP_DELTA = 1;
const WHEEL_DOWN_DELTA = -1;
const BUTTON_BY_SGR_LOW_BITS: readonly (PointerButton | undefined)[] =
    [PointerButton.Left, PointerButton.Middle, PointerButton.Right, undefined];

const FIRST_PRINTABLE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7f;

const UNSHIFTED = false;
const NAMED_KEYS: readonly (readonly [string, Key])[] = [
    ["up", Key.Up], ["down", Key.Down], ["left", Key.Left], ["right", Key.Right],
    ["return", Key.Enter], ["enter", Key.Enter], ["tab", Key.Tab], ["escape", Key.Escape], ["space", Key.Space],
    ["backspace", Key.Backspace], ["delete", Key.Delete], ["insert", Key.Insert],
    ["home", Key.Home], ["end", Key.End], ["pageup", Key.PageUp], ["pagedown", Key.PageDown],
    ["f1", Key.F1], ["f2", Key.F2], ["f3", Key.F3], ["f4", Key.F4], ["f5", Key.F5], ["f6", Key.F6],
    ["f7", Key.F7], ["f8", Key.F8], ["f9", Key.F9], ["f10", Key.F10], ["f11", Key.F11], ["f12", Key.F12],
];
const KEY_BY_DECODED_NAME: ReadonlyMap<string, CharacterKey> =
    new Map(NAMED_KEYS.map(([name, key]) => [name, {key, shift: UNSHIFTED}]));

export type NoTtyPolicy = "warn" | "throw" | "silent";

const DEFAULT_NO_TTY_POLICY: NoTtyPolicy = "warn";

export interface TerminalInputOptions {
    readonly terminal: TerminalInputSource;
    readonly platform: Pick<Platform, "onExit">;
    readonly sink: InputEventSink;
    readonly mouse?: boolean;
    readonly hideCursor?: boolean;
    readonly keyReleaseDelayMs?: number;
    readonly noTTY?: NoTtyPolicy;
}

function decodedKeyOf(decoded: DecodedKey): CharacterKey | undefined {
    if (decoded.name === undefined) return keyForCharacter(decoded.sequence);
    return KEY_BY_DECODED_NAME.get(decoded.name) ?? keyForCharacter(decoded.name);
}

function typedText(decoded: DecodedKey): string | undefined {
    if (decoded.ctrl || decoded.meta) return undefined;
    const sequence = decoded.sequence;
    const codePoint = sequence.codePointAt(0);
    if (codePoint === undefined || String.fromCodePoint(codePoint).length !== sequence.length) return undefined;
    if (codePoint < FIRST_PRINTABLE_CODE_POINT || codePoint === DELETE_CODE_POINT) return undefined;
    return sequence;
}

export class TerminalInput {
    private readonly terminal: TerminalInputSource;
    private readonly platform: Pick<Platform, "onExit">;
    private readonly sink: InputEventSink;
    private readonly mouse: boolean;
    private readonly hideCursor: boolean;
    private readonly keyReleaseDelayMs: number;
    private readonly noTTY: NoTtyPolicy;

    private _running = false;
    private stopWatchingExit: (() => void) | undefined;
    private readonly keyDecoder = new AnsiKeyDecoder(key => this.handleKey(key));
    private readonly releaseTimers = new Map<Key, ReturnType<typeof setTimeout>>();
    private readonly buttonsHeld = new Set<PointerButton>();
    private pointerX = 0;
    private pointerY = 0;

    private readonly onData = (data: string): void => this.handleData(data);
    private readonly onExit = (): void => {
        this.stop();
    };

    public constructor(options: TerminalInputOptions) {
        this.terminal = options.terminal;
        this.platform = options.platform;
        this.sink = options.sink;
        this.mouse = options.mouse ?? MOUSE_BY_DEFAULT;
        this.hideCursor = options.hideCursor ?? HIDE_CURSOR_BY_DEFAULT;
        this.keyReleaseDelayMs = options.keyReleaseDelayMs ?? DEFAULT_KEY_RELEASE_DELAY_MS;
        this.noTTY = options.noTTY ?? DEFAULT_NO_TTY_POLICY;
    }

    public get running(): boolean {
        return this._running;
    }

    public start(): this {
        if (this._running) return this;
        if (!this.terminal.available()) {
            if (this.noTTY === "throw") throw new Error(NO_TTY_MESSAGE);
            if (this.noTTY === "warn") console.error(NO_TTY_MESSAGE);
            return this;
        }

        this._running = true;
        this.stopWatchingExit = this.platform.onExit(this.onExit);
        this.terminal.start(this.onData);
        const stoppedWhileStarting = !this._running;
        if (stoppedWhileStarting) return this;

        if (this.mouse) this.terminal.write(ENABLE_MOUSE);
        if (this.hideCursor) this.terminal.write(HIDE_CURSOR);
        return this;
    }

    public stop(): this {
        if (!this._running) return this;
        this._running = false;

        this.terminal.stop();
        if (this.mouse) this.terminal.write(DISABLE_MOUSE);
        if (this.hideCursor) this.terminal.write(SHOW_CURSOR);
        this.keyDecoder.reset();

        this.stopWatchingExit?.();
        this.stopWatchingExit = undefined;
        this.releaseHeld();
        return this;
    }

    private handleData(data: string): void {
        let keyBytesStart = 0;
        for (const report of data.matchAll(SGR_MOUSE_REPORT)) {
            if (report.index > keyBytesStart) this.keyDecoder.write(data.slice(keyBytesStart, report.index));
            this.handleMouseReport(report);
            keyBytesStart = report.index + report[0].length;
        }
        if (keyBytesStart < data.length) this.keyDecoder.write(data.slice(keyBytesStart));
    }

    private handleKey(decoded: DecodedKey): void {
        if (!this._running) return;
        const mapped = decodedKeyOf(decoded);
        if (mapped !== undefined) {
            this.pressKey(mapped.key, {
                ctrl: decoded.ctrl,
                alt: decoded.meta,
                shift: decoded.shift || mapped.shift,
                meta: false,
            });
        }
        const text = typedText(decoded);
        if (text !== undefined) this.sink.enqueue({type: "text", text});
    }

    private pressKey(key: Key, modifiers: Modifiers): void {
        const pendingRelease = this.releaseTimers.get(key);
        const repeat = pendingRelease !== undefined;
        if (repeat) clearTimeout(pendingRelease);
        this.releaseTimers.set(key, setTimeout(() => this.releaseKey(key), this.keyReleaseDelayMs));
        this.sink.enqueue({type: "keyDown", key, repeat, ...modifiers});
    }

    private releaseKey(key: Key): void {
        this.releaseTimers.delete(key);
        this.sink.enqueue({type: "keyUp", key, ...NO_MODIFIERS});
    }

    private handleMouseReport(report: RegExpExecArray): void {
        if (!this._running) return;
        const code = Number.parseInt(report[1], DECIMAL);
        const x = Number.parseInt(report[2], DECIMAL) - SGR_FIRST_CELL;
        const y = Number.parseInt(report[3], DECIMAL) - SGR_FIRST_CELL;
        const modifiers: Modifiers = {
            ctrl: (code & SGR_CTRL_BIT) !== 0,
            alt: (code & SGR_META_BIT) !== 0,
            shift: (code & SGR_SHIFT_BIT) !== 0,
            meta: false,
        };
        this.pointerX = x;
        this.pointerY = y;

        if ((code & SGR_WHEEL_BIT) !== 0) {
            const delta = (code & SGR_WHEEL_DOWN_BIT) !== 0 ? WHEEL_DOWN_DELTA : WHEEL_UP_DELTA;
            this.sink.enqueue({type: "wheel", delta, x, y, ...modifiers});
            return;
        }
        if ((code & SGR_MOTION_BIT) !== 0) {
            this.sink.enqueue({type: "pointerMove", x, y, ...modifiers});
            return;
        }

        const button = BUTTON_BY_SGR_LOW_BITS[code & SGR_BUTTON_MASK];
        if (button === undefined) return;
        if (report[4] === SGR_RELEASE_SUFFIX) {
            this.buttonsHeld.delete(button);
            this.sink.enqueue({type: "pointerUp", button, x, y, ...modifiers});
        } else {
            this.buttonsHeld.add(button);
            this.sink.enqueue({type: "pointerDown", button, x, y, ...modifiers});
        }
    }

    private releaseHeld(): void {
        const keys = [...this.releaseTimers.keys()];
        for (const timer of this.releaseTimers.values()) clearTimeout(timer);
        this.releaseTimers.clear();
        for (const key of keys) this.sink.enqueue({type: "keyUp", key, ...NO_MODIFIERS});

        const buttons = [...this.buttonsHeld];
        this.buttonsHeld.clear();
        for (const button of buttons) {
            this.sink.enqueue({type: "pointerUp", button, x: this.pointerX, y: this.pointerY, ...NO_MODIFIERS});
        }
    }
}
