import {AnsiKeyDecoder} from "./ansiKeyDecoder";
import type {DecodedKey} from "./ansiKeyDecoder";
import {isPrintableCodePoint} from "./keyReport";
import type {KeyReport} from "./keyReport";
import {
    KITTY_FLAGS_REPLY,
    KITTY_FUNCTIONAL_KEY_REPORT,
    KITTY_KEY_REPORT,
    kittyFlagsReplyReportsEventTypes,
    kittyFunctionalReportHasEventType,
    POP_KITTY_KEYBOARD_FLAGS,
    PUSH_KITTY_KEYBOARD_FLAGS,
    QUERY_KITTY_KEYBOARD_FLAGS,
    readKittyFunctionalKeyReport,
    readKittyKeyReport,
} from "./kittyKeyboardProtocol";
import type {KittyKeyReport} from "./kittyKeyboardProtocol";
import {DISABLE_WIN32_INPUT_MODE, ENABLE_WIN32_INPUT_MODE, readWin32KeyReport, WIN32_KEY_REPORT} from "./win32InputMode";
import {Key, keyForCharacter, NO_MODIFIERS, PointerButton} from "../../../engine/input";
import type {CharacterKey, InputEventSink, Modifiers} from "../../../engine/input";
import type {Platform} from "../../../engine/platform";
import type {TerminalInputSource} from "../terminalInputSource";

const ESCAPE = "\x1b";
const CSI = `${ESCAPE}[`;
const REPORT_ALL_MOTION_MODE = "?1003";
const SGR_EXTENDED_COORDINATES_MODE = "?1006";
const CURSOR_VISIBLE_MODE = "?25";
const FOCUS_REPORTING_MODE = "?1004";
const ENABLE_MOUSE = `${CSI}${REPORT_ALL_MOTION_MODE}h${CSI}${SGR_EXTENDED_COORDINATES_MODE}h`;
const DISABLE_MOUSE = `${CSI}${REPORT_ALL_MOTION_MODE}l${CSI}${SGR_EXTENDED_COORDINATES_MODE}l`;
const HIDE_CURSOR = `${CSI}${CURSOR_VISIBLE_MODE}l`;
const SHOW_CURSOR = `${CSI}${CURSOR_VISIBLE_MODE}h`;
const ENABLE_FOCUS_REPORTING = `${CSI}${FOCUS_REPORTING_MODE}h`;
const DISABLE_FOCUS_REPORTING = `${CSI}${FOCUS_REPORTING_MODE}l`;
const ENABLE_KEY_REPORTING =
    `${PUSH_KITTY_KEYBOARD_FLAGS}${ENABLE_WIN32_INPUT_MODE}${ENABLE_FOCUS_REPORTING}${QUERY_KITTY_KEYBOARD_FLAGS}`;
const RESTORE_KEY_REPORTING = `${DISABLE_FOCUS_REPORTING}${DISABLE_WIN32_INPUT_MODE}${POP_KITTY_KEYBOARD_FLAGS}`;
const NO_TERMINAL_MODES = "";

const DEFAULT_KEY_RELEASE_DELAY_MS = 120;
const MOUSE_BY_DEFAULT = true;
const HIDE_CURSOR_BY_DEFAULT = false;
const NO_TTY_MESSAGE = "[input] no interactive input (stdin is not a TTY) — keyboard/mouse input unavailable.";

const SGR_MOUSE_REPORT = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/y;
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

const FOCUS_REPORT = /\x1b\[([IO])/y;
const FOCUS_IN_FINAL = "I";

const INCOMPLETE_REPORT_AT_END = /\x1b(?:\[[<?]?[\d;:]*)?$/;
const MAX_HELD_REPORT_LENGTH = 64;
const NOTHING_HELD = "";
const NOT_FOUND = -1;

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
export type KeyReporting = "auto" | "legacy";
export type KeyProtocol = "legacy" | "kitty" | "win32InputMode";
type KeyReleaseSource = "reported" | "silence";

const DEFAULT_NO_TTY_POLICY: NoTtyPolicy = "warn";
const DEFAULT_KEY_REPORTING: KeyReporting = "auto";
const UNDETECTED_KEY_PROTOCOL: KeyProtocol = "legacy";

export interface TerminalInputOptions {
    readonly terminal: TerminalInputSource;
    readonly platform: Pick<Platform, "onExit">;
    readonly sink: InputEventSink;
    readonly mouse?: boolean;
    readonly hideCursor?: boolean;
    readonly keyReleaseDelayMs?: number;
    readonly keyReporting?: KeyReporting;
    readonly noTTY?: NoTtyPolicy;
}

interface ReportReader {
    readonly pattern: RegExp;
    readonly accepts: (report: RegExpExecArray) => boolean;
    readonly read: (report: RegExpExecArray) => void;
}

interface TerminalReport {
    readonly reader: ReportReader;
    readonly report: RegExpExecArray;
}

const EVERY_REPORT = (): boolean => true;

function decodedKeyOf(decoded: DecodedKey): CharacterKey | undefined {
    if (decoded.name === undefined) return keyForCharacter(decoded.sequence);
    return KEY_BY_DECODED_NAME.get(decoded.name) ?? keyForCharacter(decoded.name);
}

function typedText(decoded: DecodedKey): string | undefined {
    if (decoded.ctrl || decoded.alt) return undefined;
    const sequence = decoded.sequence;
    const codePoint = sequence.codePointAt(0);
    if (codePoint === undefined || String.fromCodePoint(codePoint).length !== sequence.length) return undefined;
    if (!isPrintableCodePoint(codePoint)) return undefined;
    return sequence;
}

export class TerminalInput {
    private readonly terminal: TerminalInputSource;
    private readonly platform: Pick<Platform, "onExit">;
    private readonly sink: InputEventSink;
    private readonly mouse: boolean;
    private readonly hideCursor: boolean;
    private readonly keyReleaseDelayMs: number;
    private readonly keyReporting: KeyReporting;
    private readonly noTTY: NoTtyPolicy;

    private _running = false;
    private _keyProtocol: KeyProtocol = UNDETECTED_KEY_PROTOCOL;
    private keyReportingToRestore = NO_TERMINAL_MODES;
    private heldReportStart = NOTHING_HELD;
    private stopWatchingExit: (() => void) | undefined;
    private readonly keyDecoder = new AnsiKeyDecoder(key => this.handleKey(key));
    private readonly releaseTimers = new Map<Key, ReturnType<typeof setTimeout>>();
    private readonly keysHeldUntilReported = new Set<Key>();
    private readonly buttonsHeld = new Set<PointerButton>();
    private pointerX = 0;
    private pointerY = 0;

    private readonly reportReaders: readonly ReportReader[] = [
        {pattern: SGR_MOUSE_REPORT, accepts: EVERY_REPORT, read: report => this.handleMouseReport(report)},
        {pattern: FOCUS_REPORT, accepts: EVERY_REPORT, read: report => this.handleFocusReport(report)},
        {pattern: KITTY_FLAGS_REPLY, accepts: EVERY_REPORT, read: report => this.handleKittyFlagsReply(report)},
        {pattern: KITTY_KEY_REPORT, accepts: EVERY_REPORT, read: report => this.handleKittyKey(readKittyKeyReport(report))},
        {
            pattern: KITTY_FUNCTIONAL_KEY_REPORT,
            accepts: report => this._keyProtocol === "kitty" || kittyFunctionalReportHasEventType(report),
            read: report => this.handleKittyKey(readKittyFunctionalKeyReport(report)),
        },
        {pattern: WIN32_KEY_REPORT, accepts: EVERY_REPORT, read: report => this.handleWin32Key(readWin32KeyReport(report))},
    ];

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
        this.keyReporting = options.keyReporting ?? DEFAULT_KEY_REPORTING;
        this.noTTY = options.noTTY ?? DEFAULT_NO_TTY_POLICY;
    }

    public get running(): boolean {
        return this._running;
    }

    public get keyProtocol(): KeyProtocol {
        return this._keyProtocol;
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
        if (this.keyReporting === "auto") {
            this.terminal.write(ENABLE_KEY_REPORTING);
            this.keyReportingToRestore = RESTORE_KEY_REPORTING;
        }
        return this;
    }

    public stop(): this {
        if (!this._running) return this;
        this._running = false;

        this.terminal.stop();
        if (this.keyReportingToRestore !== NO_TERMINAL_MODES) this.terminal.write(this.keyReportingToRestore);
        this.keyReportingToRestore = NO_TERMINAL_MODES;
        if (this.mouse) this.terminal.write(DISABLE_MOUSE);
        if (this.hideCursor) this.terminal.write(SHOW_CURSOR);
        this.keyDecoder.reset();
        this.heldReportStart = NOTHING_HELD;
        this._keyProtocol = UNDETECTED_KEY_PROTOCOL;

        this.stopWatchingExit?.();
        this.stopWatchingExit = undefined;
        this.releaseHeld();
        return this;
    }

    private handleData(data: string): void {
        const text = this.heldReportStart + data;
        this.heldReportStart = NOTHING_HELD;
        let keyBytesStart = 0;
        let escapeIndex = text.indexOf(ESCAPE);
        while (escapeIndex !== NOT_FOUND) {
            const found = this.reportAt(text, escapeIndex);
            if (found === undefined) {
                escapeIndex = text.indexOf(ESCAPE, escapeIndex + ESCAPE.length);
                continue;
            }
            if (escapeIndex > keyBytesStart) this.keyDecoder.write(text.slice(keyBytesStart, escapeIndex));
            if (!this._running) return;
            found.reader.read(found.report);
            if (!this._running) return;
            keyBytesStart = escapeIndex + found.report[0].length;
            escapeIndex = text.indexOf(ESCAPE, keyBytesStart);
        }

        const heldStart = this.incompleteReportStart(text, keyBytesStart);
        if (heldStart > keyBytesStart) this.keyDecoder.write(text.slice(keyBytesStart, heldStart));
        if (!this._running) return;
        this.heldReportStart = text.slice(heldStart);
    }

    private reportAt(text: string, index: number): TerminalReport | undefined {
        for (const reader of this.reportReaders) {
            reader.pattern.lastIndex = index;
            const report = reader.pattern.exec(text);
            if (report !== null && reader.accepts(report)) return {reader, report};
        }
        return undefined;
    }

    private incompleteReportStart(text: string, from: number): number {
        const incomplete = INCOMPLETE_REPORT_AT_END.exec(text.slice(from));
        if (incomplete === null) return text.length;
        const start = from + incomplete.index;
        const heldLength = text.length - start;
        const bareEscapeIsAKey = heldLength === ESCAPE.length && this._keyProtocol === UNDETECTED_KEY_PROTOCOL;
        if (heldLength > MAX_HELD_REPORT_LENGTH || bareEscapeIsAKey) return text.length;
        return start;
    }

    private handleKey(decoded: DecodedKey): void {
        if (!this._running) return;
        const mapped = decodedKeyOf(decoded);
        if (mapped !== undefined) {
            this.pressKeyUntilSilence(mapped.key, {
                ctrl: decoded.ctrl,
                alt: decoded.alt,
                shift: decoded.shift || mapped.shift,
                meta: false,
            });
        }
        const text = typedText(decoded);
        if (text !== undefined) this.sink.enqueue({type: "text", text});
    }

    private handleKittyFlagsReply(reply: RegExpExecArray): void {
        if (kittyFlagsReplyReportsEventTypes(reply)) this._keyProtocol = "kitty";
    }

    private handleKittyKey(report: KittyKeyReport): void {
        if (report.eventTypeReported) this._keyProtocol = "kitty";
        this.applyKeyReport(report, this._keyProtocol === "kitty" ? "reported" : "silence");
    }

    private handleWin32Key(report: KeyReport): void {
        this._keyProtocol = "win32InputMode";
        this.applyKeyReport(report, "reported");
    }

    private applyKeyReport(report: KeyReport, releaseSource: KeyReleaseSource): void {
        const key = report.key;
        if (report.transition === "release") {
            if (key !== undefined) this.releaseReportedKey(key, report.modifiers);
            return;
        }
        if (key !== undefined) {
            if (releaseSource === "reported") this.pressKeyUntilReported(key, report.modifiers);
            else this.pressKeyUntilSilence(key, report.modifiers);
        }
        if (report.text !== undefined) this.sink.enqueue({type: "text", text: report.text});
    }

    private keyHeld(key: Key): boolean {
        return this.releaseTimers.has(key) || this.keysHeldUntilReported.has(key);
    }

    private pressKeyUntilSilence(key: Key, modifiers: Modifiers): void {
        const repeat = this.keyHeld(key);
        if (!this.keysHeldUntilReported.has(key)) {
            clearTimeout(this.releaseTimers.get(key));
            this.releaseTimers.set(key, setTimeout(() => this.releaseKeyAfterSilence(key), this.keyReleaseDelayMs));
        }
        this.sink.enqueue({type: "keyDown", key, repeat, ...modifiers});
    }

    private pressKeyUntilReported(key: Key, modifiers: Modifiers): void {
        const repeat = this.keyHeld(key);
        clearTimeout(this.releaseTimers.get(key));
        this.releaseTimers.delete(key);
        this.keysHeldUntilReported.add(key);
        this.sink.enqueue({type: "keyDown", key, repeat, ...modifiers});
    }

    private releaseReportedKey(key: Key, modifiers: Modifiers): void {
        if (!this.keyHeld(key)) return;
        clearTimeout(this.releaseTimers.get(key));
        this.releaseTimers.delete(key);
        this.keysHeldUntilReported.delete(key);
        this.sink.enqueue({type: "keyUp", key, ...modifiers});
    }

    private releaseKeyAfterSilence(key: Key): void {
        this.releaseTimers.delete(key);
        this.sink.enqueue({type: "keyUp", key, ...NO_MODIFIERS});
    }

    private handleFocusReport(report: RegExpExecArray): void {
        const focused = report[1] === FOCUS_IN_FINAL;
        if (!focused) this.releaseHeld();
        this.sink.enqueue({type: "focus", focused});
    }

    private handleMouseReport(report: RegExpExecArray): void {
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
        const keys = [...this.releaseTimers.keys(), ...this.keysHeldUntilReported];
        for (const timer of this.releaseTimers.values()) clearTimeout(timer);
        this.releaseTimers.clear();
        this.keysHeldUntilReported.clear();
        for (const key of keys) this.sink.enqueue({type: "keyUp", key, ...NO_MODIFIERS});

        const buttons = [...this.buttonsHeld];
        this.buttonsHeld.clear();
        for (const button of buttons) {
            this.sink.enqueue({type: "pointerUp", button, x: this.pointerX, y: this.pointerY, ...NO_MODIFIERS});
        }
    }
}
