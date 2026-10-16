/** One key press, shaped like the key object node's readline hands to 'keypress' listeners. */
export interface DecodedKey {
    sequence: string;
    /** "undefined" (the string) for an escape sequence readline does not name. */
    name?: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    /** The escape-sequence code, e.g. "[A"; only set for escape sequences. */
    code?: string;
}

const ESCAPE = "\x1b";
/** A trailing ESC waits this long for the rest of a sequence before it counts as the Escape key. */
const ESCAPE_CODE_TIMEOUT_MS = 500;

/**
 * Raw terminal input -> key presses. This is node's readline key decoder (`emitKeys` behind
 * `readline.emitKeypressEvents`) ported line for line, so key names, modifiers and timing match
 * what the engine got from readline, on any host: node, bun, or an xterm.js `onData` stream.
 * Mouse reports must be split off before the bytes reach it.
 */
export class AnsiKeyDecoder {
    private parser = this.startParser();
    private escapeTimer: ReturnType<typeof setTimeout> | undefined;

    public constructor(private readonly onKey: (key: DecodedKey) => void) {
    }

    public write(data: string): void {
        if (data.length === 0) return;
        clearTimeout(this.escapeTimer);
        let length = 0;
        for (const character of data) {
            length += character.length;
            try {
                this.parser.next(character);
                if (length === data.length && character === ESCAPE) {
                    this.escapeTimer = setTimeout(() => this.parser.next(""), ESCAPE_CODE_TIMEOUT_MS);
                }
            } catch (error) {
                this.parser = this.startParser();
                throw error;
            }
        }
    }

    /** Drops a half-read sequence and any pending lone-ESC timeout. */
    public reset(): void {
        clearTimeout(this.escapeTimer);
        this.escapeTimer = undefined;
        this.parser = this.startParser();
    }

    private startParser(): Generator<void, never, string> {
        const parser = this.parse();
        parser.next();
        return parser;
    }

    private* parse(): Generator<void, never, string> {
        while (true) {
            let ch: string = yield;
            let s = ch;
            let escaped = false;
            const key: DecodedKey = {sequence: "", name: undefined, ctrl: false, meta: false, shift: false};

            if (ch === ESCAPE) {
                escaped = true;
                s += (ch = yield);
                if (ch === ESCAPE) s += (ch = yield);
            }

            if (escaped && (ch === "O" || ch === "[")) {
                let code = ch;
                let modifier = 0;

                if (ch === "O") {
                    // ESC O letter, ESC O modifier letter
                    s += (ch = yield);
                    if (ch >= "0" && ch <= "9") {
                        modifier = Number(ch) - 1;
                        s += (ch = yield);
                    }
                    code += ch;
                } else {
                    // ESC [ letter, ESC [ modifier letter, ESC [ [ modifier letter, ESC [ [ num char
                    s += (ch = yield);
                    if (ch === "[") {
                        code += ch;
                        s += (ch = yield);
                    }

                    // Buffer just enough for `\x1b[24;5~` (code "[24~", modifier 5) or
                    // `\x1b[1;5H` (code "[H", modifier 5): up to three digits, then an optional ;digit.
                    const cmdStart = s.length - 1;
                    if (ch >= "0" && ch <= "9") {
                        s += (ch = yield);
                        if (ch >= "0" && ch <= "9") {
                            s += (ch = yield);
                            if (ch >= "0" && ch <= "9") s += (ch = yield);
                        }
                    }
                    if (ch === ";") {
                        s += (ch = yield);
                        if (ch >= "0" && ch <= "9") s += yield;
                    }

                    const cmd = s.slice(cmdStart);
                    let match: RegExpExecArray | null;
                    if ((match = /^(?:(\d\d?)(?:;(\d))?([~^$])|(\d{3}~))$/.exec(cmd))) {
                        if (match[4]) {
                            code += match[4];
                        } else {
                            code += match[1] + match[3];
                            modifier = Number(match[2] || 1) - 1;
                        }
                    } else if ((match = /^((\d;)?(\d))?([A-Za-z])$/.exec(cmd))) {
                        code += match[4];
                        modifier = Number(match[3] || 1) - 1;
                    } else {
                        code += cmd;
                    }
                }

                key.ctrl = !!(modifier & 4);
                key.meta = !!(modifier & 10);
                key.shift = !!(modifier & 1);
                key.code = code;
                nameEscapeCode(key, code);
            } else if (ch === "\r") {
                key.name = "return";
                key.meta = escaped;
            } else if (ch === "\n") {
                key.name = "enter";
                key.meta = escaped;
            } else if (ch === "\t") {
                key.name = "tab";
                key.meta = escaped;
            } else if (ch === "\b" || ch === "\x7f") {
                key.name = "backspace";
                key.meta = escaped;
            } else if (ch === ESCAPE) {
                key.name = "escape";
                key.meta = escaped;
            } else if (ch === " ") {
                key.name = "space";
                key.meta = escaped;
            } else if (!escaped && ch <= "\x1a") {
                // ctrl+letter
                key.name = String.fromCharCode(ch.charCodeAt(0) + "a".charCodeAt(0) - 1);
                key.ctrl = true;
            } else if (/^[0-9A-Za-z]$/.test(ch)) {
                key.name = ch.toLowerCase();
                key.shift = /^[A-Z]$/.test(ch);
                key.meta = escaped;
            } else if (escaped) {
                // ESC timed out ("") or ESC + a character readline has no name for
                key.name = ch.length ? undefined : "escape";
                key.meta = true;
            }

            key.sequence = s;

            if (s.length !== 0 && (key.name !== undefined || escaped)) {
                this.onKey(key);
            } else if (charLengthAt(s, 0) === s.length) {
                // a single unnamed character, e.g. "."
                this.onKey(key);
            }
            // anything else is an unrecognised or broken sequence: dropped
        }
    }
}

function charLengthAt(text: string, index: number): number {
    if (text.length <= index) return 1;
    return text.codePointAt(index)! >= 0x10000 ? 2 : 1;
}

const NAMES_BY_CODE: Readonly<Record<string, string>> = {
    // xterm/gnome ESC [ letter (with modifier), ESC O letter (without)
    "[P": "f1", "[Q": "f2", "[R": "f3", "[S": "f4",
    "OP": "f1", "OQ": "f2", "OR": "f3", "OS": "f4",
    // xterm/rxvt ESC [ number ~
    "[11~": "f1", "[12~": "f2", "[13~": "f3", "[14~": "f4",
    // paste bracket mode
    "[200~": "paste-start", "[201~": "paste-end",
    // Cygwin and libuv
    "[[A": "f1", "[[B": "f2", "[[C": "f3", "[[D": "f4", "[[E": "f5",
    "[15~": "f5", "[17~": "f6", "[18~": "f7", "[19~": "f8", "[20~": "f9", "[21~": "f10", "[23~": "f11", "[24~": "f12",
    // xterm ESC [ letter, xterm/gnome ESC O letter
    "[A": "up", "[B": "down", "[C": "right", "[D": "left", "[E": "clear", "[F": "end", "[H": "home",
    "OA": "up", "OB": "down", "OC": "right", "OD": "left", "OE": "clear", "OF": "end", "OH": "home",
    // xterm/rxvt ESC [ number ~
    "[1~": "home", "[2~": "insert", "[3~": "delete", "[4~": "end", "[5~": "pageup", "[6~": "pagedown",
    // putty
    "[[5~": "pageup", "[[6~": "pagedown",
    // rxvt
    "[7~": "home", "[8~": "end",
};

/** rxvt sequences that carry their modifier in the code itself. */
const MODIFIED_NAMES_BY_CODE: Readonly<Record<string, {name: string, modifier: "shift" | "ctrl"}>> = {
    "[a": {name: "up", modifier: "shift"}, "[b": {name: "down", modifier: "shift"},
    "[c": {name: "right", modifier: "shift"}, "[d": {name: "left", modifier: "shift"},
    "[e": {name: "clear", modifier: "shift"},
    "[2$": {name: "insert", modifier: "shift"}, "[3$": {name: "delete", modifier: "shift"},
    "[5$": {name: "pageup", modifier: "shift"}, "[6$": {name: "pagedown", modifier: "shift"},
    "[7$": {name: "home", modifier: "shift"}, "[8$": {name: "end", modifier: "shift"},
    "Oa": {name: "up", modifier: "ctrl"}, "Ob": {name: "down", modifier: "ctrl"},
    "Oc": {name: "right", modifier: "ctrl"}, "Od": {name: "left", modifier: "ctrl"},
    "Oe": {name: "clear", modifier: "ctrl"},
    "[2^": {name: "insert", modifier: "ctrl"}, "[3^": {name: "delete", modifier: "ctrl"},
    "[5^": {name: "pageup", modifier: "ctrl"}, "[6^": {name: "pagedown", modifier: "ctrl"},
    "[7^": {name: "home", modifier: "ctrl"}, "[8^": {name: "end", modifier: "ctrl"},
    "[Z": {name: "tab", modifier: "shift"},
};

function nameEscapeCode(key: DecodedKey, code: string): void {
    if (Object.prototype.hasOwnProperty.call(NAMES_BY_CODE, code)) {
        key.name = NAMES_BY_CODE[code];
        return;
    }
    if (Object.prototype.hasOwnProperty.call(MODIFIED_NAMES_BY_CODE, code)) {
        const named = MODIFIED_NAMES_BY_CODE[code];
        key.name = named.name;
        key[named.modifier] = true;
        return;
    }
    key.name = "undefined";
}
