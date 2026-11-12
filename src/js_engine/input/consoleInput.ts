import {Key} from "./key";
import {AnsiKeyDecoder} from "./ansiKeyDecoder";
import type {DecodedKey} from "./ansiKeyDecoder";
import type {Platform} from "../platform/platform";
import {nodePlatform} from "../platform/nodePlatform";

export type Listener<T> = (payload: T) => void;

export class Signal<T = void> {
    private readonly listeners = new Set<Listener<T>>();

    add(fn: Listener<T>): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    once(fn: Listener<T>): () => void {
        const off = this.add((p) => { off(); fn(p); });
        return off;
    }

    remove(fn: Listener<T>): void { this.listeners.delete(fn); }
    clear(): void { this.listeners.clear(); }

    invoke(payload: T): void {
        const listenersAtDispatch = [...this.listeners];
        for (const fn of listenersAtDispatch) {
            try { fn(payload); }
            catch (err) { console.error('[input] listener threw:', err); }
        }
    }

    get size(): number { return this.listeners.size; }
}

const CSI = '\x1b[';
const REPORT_ALL_MOTION_MODE = '?1003';
const SGR_EXTENDED_COORDINATES_MODE = '?1006';
const CURSOR_VISIBLE_MODE = '?25';
const ENABLE_MOUSE  = `${CSI}${REPORT_ALL_MOTION_MODE}h${CSI}${SGR_EXTENDED_COORDINATES_MODE}h`;
const DISABLE_MOUSE = `${CSI}${REPORT_ALL_MOTION_MODE}l${CSI}${SGR_EXTENDED_COORDINATES_MODE}l`;
const HIDE_CURSOR   = `${CSI}${CURSOR_VISIBLE_MODE}l`;
const SHOW_CURSOR   = `${CSI}${CURSOR_VISIBLE_MODE}h`;

const DEFAULT_KEY_RELEASE_DELAY_MS = 120;

const SGR_RELEASE_SUFFIX = 'm';
const SGR_SHIFT_BIT = 4;
const SGR_META_BIT = 8;
const SGR_CTRL_BIT = 16;
const SGR_MOTION_BIT = 32;
const SGR_WHEEL_BIT = 64;
const SGR_WHEEL_DOWN_BIT = 1;
const SGR_BUTTON_MASK = 3;

export interface KeyEvent {
    id: string;
    name?: string;
    sequence: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    repeat: boolean;
}

export type KeyName = Key | (string & {});

const CANONICAL_KEY_BY_ALIAS: Readonly<Record<string, string>> = {
    control: 'ctrl',
    ctl: 'ctrl',
    option: 'alt',
    meta: 'alt',
    esc: 'escape',
    del: 'delete',
    ins: 'insert',
    pgup: 'pageup',
    pgdn: 'pagedown',
    enter: 'return',
    spacebar: 'space',
    ' ': 'space',
};

function normalizeKey(name: string): string {
    const lower = name.toLowerCase();
    return CANONICAL_KEY_BY_ALIAS[lower] ?? lower;
}

export type MouseButton =
    | 'left' | 'middle' | 'right'
    | 'wheelUp' | 'wheelDown'
    | 'none';

export type MouseEventType = 'press' | 'release' | 'move' | 'drag' | 'wheel';

export interface MouseEvent {
    type: MouseEventType;
    button: MouseButton;
    x: number;
    y: number;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    raw: number;
}

export interface InputOptions {
    mouse?: boolean;
    hideCursor?: boolean;
    keyReleaseDelayMs?: number;
    noTTY?: 'warn' | 'throw' | 'silent';
    platform?: Platform;
}

export class ConsoleInput {
    readonly onKey       = new Signal<KeyEvent>();
    readonly onKeyDown   = new Signal<KeyEvent>();
    readonly onKeyUp     = new Signal<KeyEvent>();
    readonly onMouse     = new Signal<MouseEvent>();
    readonly onMouseDown = new Signal<MouseEvent>();
    readonly onMouseUp   = new Signal<MouseEvent>();
    readonly onMouseMove = new Signal<MouseEvent>();
    readonly onWheel     = new Signal<MouseEvent>();

    private readonly keysDown    = new Set<string>();
    private readonly buttonsDown = new Set<MouseButton>();
    private _mouseX = 0;
    private _mouseY = 0;

    private readonly keyPressedFrame    = new Set<string>();
    private readonly keyReleasedFrame   = new Set<string>();
    private readonly mousePressedFrame  = new Set<MouseButton>();
    private readonly mouseReleasedFrame = new Set<MouseButton>();
    private _wheelDeltaFrame = 0;

    private options!: Required<Omit<InputOptions, 'platform'>>;
    private enabled = false;
    private platform: Platform | undefined;
    private stopWatchingExit: (() => void) | undefined;
    private readonly keyDecoder = new AnsiKeyDecoder((key) => this.handleKeypress(key));
    private readonly releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

    private readonly onInputData = (data: string) => this.handleData(data);
    private readonly onExit      = () => this.disable();

    private static readonly SGR_MOUSE_REPORT = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

    get mouseX(): number { return this._mouseX; }
    get mouseY(): number { return this._mouseY; }
    get isEnabled(): boolean { return this.enabled; }

    enable(options: InputOptions = {}): this {
        if (this.enabled) return this;

        this.options = {
            mouse: options.mouse ?? true,
            hideCursor: options.hideCursor ?? false,
            keyReleaseDelayMs: options.keyReleaseDelayMs ?? DEFAULT_KEY_RELEASE_DELAY_MS,
            noTTY: options.noTTY ?? 'warn',
        };

        const platform = options.platform ?? nodePlatform();
        if (!platform.input.available()) {
            const msg = '[input] no interactive input (stdin is not a TTY) — keyboard/mouse input unavailable.';
            if (this.options.noTTY === 'throw') throw new Error(msg);
            if (this.options.noTTY === 'warn') console.error(msg);
            return this;
        }

        this.platform = platform;
        this.enabled = true;
        this.stopWatchingExit = platform.onExit(this.onExit);

        platform.input.start(this.onInputData);
        const disabledByListenerDuringStart = !this.enabled;
        if (disabledByListenerDuringStart) return this;

        if (this.options.mouse)      platform.output.write(ENABLE_MOUSE);
        if (this.options.hideCursor) platform.output.write(HIDE_CURSOR);
        return this;
    }

    disable(): this {
        if (!this.enabled) return this;
        this.enabled = false;

        for (const t of this.releaseTimers.values()) clearTimeout(t);
        this.releaseTimers.clear();

        const platform = this.platform!;
        platform.input.stop();

        if (this.options.mouse)      platform.output.write(DISABLE_MOUSE);
        if (this.options.hideCursor) platform.output.write(SHOW_CURSOR);

        this.keyDecoder.reset();

        this.stopWatchingExit?.();
        this.stopWatchingExit = undefined;
        this.platform = undefined;

        this.clearFrame();
        this.keysDown.clear();
        this.buttonsDown.clear();
        return this;
    }

    keyDown(id: string): boolean { return this.keysDown.has(id); }
    keyPressed(id: string): boolean { return this.keyPressedFrame.has(id); }
    keyReleased(id: string): boolean { return this.keyReleasedFrame.has(id); }

    mouseButtonDown(b: MouseButton): boolean { return this.buttonsDown.has(b); }
    mousePressed(b: MouseButton): boolean { return this.mousePressedFrame.has(b); }
    mouseReleased(b: MouseButton): boolean { return this.mouseReleasedFrame.has(b); }
    get wheelDelta(): number { return this._wheelDeltaFrame; }

    endFrame(): void { this.clearFrame(); }

    private clearFrame(): void {
        this.keyPressedFrame.clear();
        this.keyReleasedFrame.clear();
        this.mousePressedFrame.clear();
        this.mouseReleasedFrame.clear();
        this._wheelDeltaFrame = 0;
    }

    onKeyMatch(
        match: Partial<Pick<KeyEvent, 'name' | 'ctrl' | 'meta' | 'shift'>>,
        cb: Listener<KeyEvent>,
    ): () => void {
        return this.onKey.add((e) => {
            for (const k in match) {
                if ((match as Record<string, unknown>)[k] !== (e as unknown as Record<string, unknown>)[k]) return;
            }
            cb(e);
        });
    }

    whenKeyDown(key: KeyName, cb: Listener<KeyEvent>): () => void {
        const target = normalizeKey(key);
        return this.onKeyDown.add((e) => { if (this.matchesKey(target, e)) cb(e); });
    }

    whenKeyUp(key: KeyName, cb: Listener<KeyEvent>): () => void {
        const target = normalizeKey(key);
        return this.onKeyUp.add((e) => { if (this.matchesKey(target, e)) cb(e); });
    }

    whenKey(key: KeyName, cb: Listener<KeyEvent>): () => void {
        const target = normalizeKey(key);
        return this.onKey.add((e) => { if (this.matchesKey(target, e)) cb(e); });
    }

    private matchesKey(target: string, e: KeyEvent): boolean {
        switch (target) {
            case 'ctrl':   return e.ctrl;
            case 'alt':    return e.meta;
            case 'shift':  return e.shift;
            case 'return': return e.id === 'return' || e.id === 'enter';
            default:       return e.id === target;
        }
    }

    private handleData(data: string): void {
        const re = ConsoleInput.SGR_MOUSE_REPORT;
        re.lastIndex = 0;
        let textStart = 0;
        let m: RegExpExecArray | null;

        while ((m = re.exec(data)) !== null) {
            if (m.index > textStart) this.keyDecoder.write(data.slice(textStart, m.index));
            this.handleMouse(m);
            textStart = re.lastIndex;
        }
        if (textStart < data.length) this.keyDecoder.write(data.slice(textStart));
    }

    private handleKeypress(key: DecodedKey): void {
        const id = key.name ?? key.sequence;
        if (!id) return;

        const repeat = this.keysDown.has(id);
        const ev: KeyEvent = {
            id,
            name: key.name,
            sequence: key.sequence,
            ctrl: !!key.ctrl,
            meta: !!key.meta,
            shift: !!key.shift,
            repeat,
        };

        if (!repeat) {
            this.keysDown.add(id);
            this.keyPressedFrame.add(id);
            this.onKeyDown.invoke(ev);
        }
        this.onKey.invoke(ev);

        this.rearmSyntheticRelease(id);
    }

    private rearmSyntheticRelease(id: string): void {
        const pendingRelease = this.releaseTimers.get(id);
        if (pendingRelease) clearTimeout(pendingRelease);
        this.releaseTimers.set(
            id,
            setTimeout(() => this.releaseKey(id), this.options.keyReleaseDelayMs),
        );
    }

    private releaseKey(id: string): void {
        this.releaseTimers.delete(id);
        if (!this.keysDown.delete(id)) return;
        this.keyReleasedFrame.add(id);
        this.onKeyUp.invoke({
            id, name: id, sequence: id,
            ctrl: false, meta: false, shift: false, repeat: false,
        });
    }

    private handleMouse(m: RegExpExecArray): void {
        const sgrButton = parseInt(m[1], 10);
        const x  = parseInt(m[2], 10);
        const y  = parseInt(m[3], 10);
        const released = m[4] === SGR_RELEASE_SUFFIX;

        const shift  = !!(sgrButton & SGR_SHIFT_BIT);
        const meta   = !!(sgrButton & SGR_META_BIT);
        const ctrl   = !!(sgrButton & SGR_CTRL_BIT);
        const motion = !!(sgrButton & SGR_MOTION_BIT);
        const wheel  = !!(sgrButton & SGR_WHEEL_BIT);

        this._mouseX = x;
        this._mouseY = y;

        let button: MouseButton;
        let type: MouseEventType;

        if (wheel) {
            button = (sgrButton & SGR_WHEEL_DOWN_BIT) ? 'wheelDown' : 'wheelUp';
            type = 'wheel';
        } else {
            const low = sgrButton & SGR_BUTTON_MASK;
            button =
                low === 0 ? 'left' :
                    low === 1 ? 'middle' :
                        low === 2 ? 'right' : 'none';
            if (motion) type = button === 'none' ? 'move' : 'drag';
            else        type = released ? 'release' : 'press';
        }

        const ev: MouseEvent = { type, button, x, y, ctrl, meta, shift, raw: sgrButton };

        switch (type) {
            case 'press':
                this.buttonsDown.add(button);
                this.mousePressedFrame.add(button);
                this.onMouseDown.invoke(ev);
                break;
            case 'release':
                this.buttonsDown.delete(button);
                this.mouseReleasedFrame.add(button);
                this.onMouseUp.invoke(ev);
                break;
            case 'wheel':
                this._wheelDeltaFrame += button === 'wheelUp' ? 1 : -1;
                this.onWheel.invoke(ev);
                break;
            case 'move':
            case 'drag':
                this.onMouseMove.invoke(ev);
                break;
        }

        this.onMouse.invoke(ev);
    }
}

export const input = new ConsoleInput();
