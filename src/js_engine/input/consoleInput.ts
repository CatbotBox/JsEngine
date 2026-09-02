import * as readline from 'node:readline';
import {PassThrough} from 'node:stream';
import {Key} from "./key";

// Signal — tiny typed event emitter (replaces ./util/event)

export type Listener<T> = (payload: T) => void;

export class Signal<T = void> {
    private readonly listeners = new Set<Listener<T>>();

    /** Subscribe. Returns an unsubscribe function. */
    add(fn: Listener<T>): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /** Subscribe for exactly one invocation. */
    once(fn: Listener<T>): () => void {
        const off = this.add((p) => { off(); fn(p); });
        return off;
    }

    remove(fn: Listener<T>): void { this.listeners.delete(fn); }
    clear(): void { this.listeners.clear(); }

    invoke(payload: T): void {
        // iterate a copy so a listener may unsubscribe mid-dispatch safely
        for (const fn of [...this.listeners]) {
            try { fn(payload); }
            catch (err) { console.error('[input] listener threw:', err); }
        }
    }

    get size(): number { return this.listeners.size; }
}

// Terminal control sequences

// 1003 = report ALL motion, 1006 = SGR extended coordinates (needed for x/y > 223)
const ENABLE_MOUSE  = '\x1b[?1003h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1003l\x1b[?1006l'; // disable the SAME modes we enabled
const HIDE_CURSOR   = '\x1b[?25l';
const SHOW_CURSOR   = '\x1b[?25h';

// Public types

export interface KeyEvent {
    /** canonical id used by keyDown()/keyPressed(): key.name, else raw sequence */
    id: string;
    name?: string;
    sequence: string;
    ctrl: boolean;
    meta: boolean;   // Alt / Option
    shift: boolean;
    /** true when produced by OS key-repeat rather than the initial press */
    repeat: boolean;
}

/** Any Key enum member, or any raw key string (e.g. a single character like '/'). */
export type KeyName = Key | (string & {});

/** Friendly spellings normalised to their canonical Key value. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
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
    return KEY_ALIASES[lower] ?? lower;
}

export type MouseButton =
    | 'left' | 'middle' | 'right'
    | 'wheelUp' | 'wheelDown'
    | 'none';

export type MouseEventType = 'press' | 'release' | 'move' | 'drag' | 'wheel';

export interface MouseEvent {
    type: MouseEventType;
    button: MouseButton;
    x: number; // 1-based column
    y: number; // 1-based row
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    raw: number; // the decoded SGR button byte, for advanced use
}

export interface InputOptions {
    /** enable mouse reporting. default true */
    mouse?: boolean;
    /** hide the terminal cursor while active. default false */
    hideCursor?: boolean;
    /** ms of silence after the last key event before a key is treated as released. default 120 */
    keyReleaseDelayMs?: number;
    /** behaviour when stdin is not a TTY. default 'warn' */
    noTTY?: 'warn' | 'throw' | 'silent';
}

/** Minimal shape of the object readline hands to the 'keypress' listener. */
interface KeyRaw {
    sequence: string;
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
}

// InputSystem

export class ConsoleInput {
    // events
    readonly onKey       = new Signal<KeyEvent>();   // every key event, incl. repeats
    readonly onKeyDown   = new Signal<KeyEvent>();   // transition to pressed only
    readonly onKeyUp     = new Signal<KeyEvent>();   // synthetic; see class docstring
    readonly onMouse     = new Signal<MouseEvent>(); // every mouse event
    readonly onMouseDown = new Signal<MouseEvent>();
    readonly onMouseUp   = new Signal<MouseEvent>();
    readonly onMouseMove = new Signal<MouseEvent>(); // move + drag
    readonly onWheel     = new Signal<MouseEvent>();

    // persistent state
    private readonly keysDown    = new Set<string>();
    private readonly buttonsDown = new Set<MouseButton>();
    private _mouseX = 0;
    private _mouseY = 0;

    // per-frame edge state
    private readonly keyPressedFrame    = new Set<string>();
    private readonly keyReleasedFrame   = new Set<string>();
    private readonly mousePressedFrame  = new Set<MouseButton>();
    private readonly mouseReleasedFrame = new Set<MouseButton>();
    private _wheelDeltaFrame = 0;

    // internals
    private options!: Required<InputOptions>;
    private enabled = false;
    private kbStream: PassThrough | null = null;
    private readonly releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // bound handlers (stable refs so we can remove them on disable)
    private readonly onStdinData = (chunk: string | Buffer) => this.handleData(chunk);
    private readonly onKeypress  = (s: string | undefined, k: KeyRaw | undefined) => this.handleKeypress(s, k);
    private readonly onExit      = () => this.disable();

    // SGR mouse: ESC [ < btn ; x ; y (M=press/motion | m=release)
    private static readonly MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

    get mouseX(): number { return this._mouseX; }
    get mouseY(): number { return this._mouseY; }
    get isEnabled(): boolean { return this.enabled; }

    // lifecycle

    enable(options: InputOptions = {}): this {
        if (this.enabled) return this;

        this.options = {
            mouse: options.mouse ?? true,
            hideCursor: options.hideCursor ?? false,
            keyReleaseDelayMs: options.keyReleaseDelayMs ?? 120,
            noTTY: options.noTTY ?? 'warn',
        };

        if (!process.stdin.isTTY) {
            const msg = '[input] stdin is not a TTY — keyboard/mouse input unavailable.';
            if (this.options.noTTY === 'throw') throw new Error(msg);
            if (this.options.noTTY === 'warn') console.error(msg);
            return this; // stay disabled rather than crash (safe in CI / piped runs)
        }

        // Private keyboard decoder. readline reads THIS stream, never stdin directly,
        // so it only ever sees the non-mouse bytes we forward to it.
        const kb = new PassThrough();
        readline.emitKeypressEvents(kb);
        kb.on('keypress', this.onKeypress);
        this.kbStream = kb;

        process.stdin.setRawMode(true);   // char-by-char, no echo, no auto-SIGINT
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', this.onStdinData);

        if (this.options.mouse)      process.stdout.write(ENABLE_MOUSE);
        if (this.options.hideCursor) process.stdout.write(HIDE_CURSOR);

        // best-effort terminal restore on process teardown
        process.once('exit', this.onExit);
        process.once('SIGTERM', this.onExit);

        this.enabled = true;
        return this;
    }

    disable(): this {
        if (!this.enabled) return this;
        this.enabled = false;

        for (const t of this.releaseTimers.values()) clearTimeout(t);
        this.releaseTimers.clear();

        process.stdin.removeListener('data', this.onStdinData);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();

        if (this.options.mouse)      process.stdout.write(DISABLE_MOUSE);
        if (this.options.hideCursor) process.stdout.write(SHOW_CURSOR);

        this.kbStream?.removeListener('keypress', this.onKeypress);
        this.kbStream?.destroy();
        this.kbStream = null;

        process.removeListener('exit', this.onExit);
        process.removeListener('SIGTERM', this.onExit);

        this.clearFrame();
        this.keysDown.clear();
        this.buttonsDown.clear();
        return this;
    }

    // frame polling API

    /** Held down right now (best-effort for keys — see docstring). */
    keyDown(id: string): boolean { return this.keysDown.has(id); }
    /** Went down during this frame (edge). */
    keyPressed(id: string): boolean { return this.keyPressedFrame.has(id); }
    /** Went up during this frame (edge, synthetic for keys). */
    keyReleased(id: string): boolean { return this.keyReleasedFrame.has(id); }

    mouseButtonDown(b: MouseButton): boolean { return this.buttonsDown.has(b); }
    mousePressed(b: MouseButton): boolean { return this.mousePressedFrame.has(b); }
    mouseReleased(b: MouseButton): boolean { return this.mouseReleasedFrame.has(b); }
    /** Net wheel this frame: +1 per notch up, -1 per notch down. */
    get wheelDelta(): number { return this._wheelDeltaFrame; }

    /** Call once at the END of every game-loop iteration to reset per-frame edges. */
    endFrame(): void { this.clearFrame(); }

    private clearFrame(): void {
        this.keyPressedFrame.clear();
        this.keyReleasedFrame.clear();
        this.mousePressedFrame.clear();
        this.mouseReleasedFrame.clear();
        this._wheelDeltaFrame = 0;
    }

    // filtered subscription

    /** Subscribe to key events matching every provided field. Returns unsubscribe. */
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

    // named key subscription

    /**
     * Fire `cb` when `key` transitions to pressed.
     * `key` accepts any Key / character, plus the modifiers 'shift' | 'ctrl' | 'alt'
     * (aliases: 'control', 'option', 'meta'). Matching is case-insensitive.
     * Modifiers match while held during another key event — a terminal cannot report
     * a bare modifier tap. Returns an unsubscribe function.
     *
     *   input.whenKeyDown(Key.Space, () => jump());
     *   input.whenKeyDown('w', () => moveUp());
     *   input.whenKeyDown('ctrl', (e) => console.log('ctrl held on', e.id));
     */
    whenKeyDown(key: KeyName, cb: Listener<KeyEvent>): () => void {
        const target = normalizeKey(key);
        return this.onKeyDown.add((e) => { if (this.matchesKey(target, e)) cb(e); });
    }

    /**
     * Fire `cb` on the (synthetic) release of `key`. See the class docstring —
     * terminals fake key-up via a silence timeout, and modifier flags are not
     * carried on release, so modifier targets won't match here.
     */
    whenKeyUp(key: KeyName, cb: Listener<KeyEvent>): () => void {
        const target = normalizeKey(key);
        return this.onKeyUp.add((e) => { if (this.matchesKey(target, e)) cb(e); });
    }

    /**
     * Fire on EVERY matching key event, including OS key-repeat while held.
     * Use this for hold-to-repeat behaviour (e.g. holding an arrow to keep moving).
     */
    whenKey(key: KeyName, cb: Listener<KeyEvent>): () => void {
        const target = normalizeKey(key);
        return this.onKey.add((e) => { if (this.matchesKey(target, e)) cb(e); });
    }

    private matchesKey(target: string, e: KeyEvent): boolean {
        switch (target) {
            case 'ctrl':   return e.ctrl;
            case 'alt':    return e.meta;                             // readline reports Alt as `meta`
            case 'shift':  return e.shift;
            case 'return': return e.id === 'return' || e.id === 'enter'; // \r or \n
            default:       return e.id === target;
        }
    }

    // raw stream handling

    private handleData(chunk: string | Buffer): void {
        const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

        const re = ConsoleInput.MOUSE;
        re.lastIndex = 0;
        let last = 0;
        let m: RegExpExecArray | null;

        // Split the chunk into [text][mouse][text][mouse]... preserving order,
        // forwarding text to the keyboard decoder and handling mouse inline.
        while ((m = re.exec(data)) !== null) {
            if (m.index > last) this.kbStream?.write(data.slice(last, m.index));
            this.handleMouse(m);
            last = re.lastIndex;
        }
        if (last < data.length) this.kbStream?.write(data.slice(last));
    }

    // keyboard

    private handleKeypress(_str: string | undefined, key: KeyRaw | undefined): void {
        if (!key) return;

        // NOTE: Ctrl+C arrives as an ordinary key event ({ name: 'c', ctrl: true }).
        // Raw mode disables the automatic SIGINT, and this system intentionally does
        // NOT exit on its own — subscribe to control shutdown yourself, e.g.:
        //   input.onKeyMatch({ name: 'c', ctrl: true }, () => { cleanup(); process.exit(0); });

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

        // (re)arm the synthetic-release timer: no repeat within the window => "up"
        const prev = this.releaseTimers.get(id);
        if (prev) clearTimeout(prev);
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

    // mouse (SGR 1006)

    private handleMouse(m: RegExpExecArray): void {
        const sgrButton = parseInt(m[1], 10);
        const x  = parseInt(m[2], 10);
        const y  = parseInt(m[3], 10);
        const released = m[4] === 'm';

        const shift  = !!(sgrButton & 4);
        const meta   = !!(sgrButton & 8);
        const ctrl   = !!(sgrButton & 16);
        const motion = !!(sgrButton & 32);
        const wheel  = !!(sgrButton & 64);

        this._mouseX = x;
        this._mouseY = y;

        let button: MouseButton;
        let type: MouseEventType;

        if (wheel) {
            button = (sgrButton & 1) ? 'wheelDown' : 'wheelUp';
            type = 'wheel';
        } else {
            const low = sgrButton & 3;
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

// Singleton — import { input } from './input'

export const input = new ConsoleInput();
