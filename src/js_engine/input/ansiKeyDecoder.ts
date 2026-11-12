export interface DecodedKey {
    sequence: string;
    name?: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    code?: string;
}

const ESCAPE = "\x1b";
const DELETE = "\x7f";
const LAST_CTRL_LETTER = "\x1a";
const TRAILING_ESCAPE_WAIT_MS = 500;
const SHIFT_MODIFIER_BIT = 1;
const CTRL_MODIFIER_BIT = 4;
const ALT_OR_META_MODIFIER_BITS = 10;
const FIRST_ASTRAL_CODE_POINT = 0x10000;
const UNNAMED_ESCAPE_CODE_NAME = "undefined";

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
                    this.escapeTimer = setTimeout(() => this.parser.next(""), TRAILING_ESCAPE_WAIT_MS);
                }
            } catch (error) {
                this.parser = this.startParser();
                throw error;
            }
        }
    }

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
                    s += (ch = yield);
                    if (ch >= "0" && ch <= "9") {
                        modifier = Number(ch) - 1;
                        s += (ch = yield);
                    }
                    code += ch;
                } else {
                    s += (ch = yield);
                    if (ch === "[") {
                        code += ch;
                        s += (ch = yield);
                    }

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

                key.ctrl = !!(modifier & CTRL_MODIFIER_BIT);
                key.meta = !!(modifier & ALT_OR_META_MODIFIER_BITS);
                key.shift = !!(modifier & SHIFT_MODIFIER_BIT);
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
            } else if (ch === "\b" || ch === DELETE) {
                key.name = "backspace";
                key.meta = escaped;
            } else if (ch === ESCAPE) {
                key.name = "escape";
                key.meta = escaped;
            } else if (ch === " ") {
                key.name = "space";
                key.meta = escaped;
            } else if (!escaped && ch <= LAST_CTRL_LETTER) {
                key.name = String.fromCharCode(ch.charCodeAt(0) + "a".charCodeAt(0) - 1);
                key.ctrl = true;
            } else if (/^[0-9A-Za-z]$/.test(ch)) {
                key.name = ch.toLowerCase();
                key.shift = /^[A-Z]$/.test(ch);
                key.meta = escaped;
            } else if (escaped) {
                const escapeTimedOut = !ch.length;
                key.name = escapeTimedOut ? "escape" : undefined;
                key.meta = true;
            }

            key.sequence = s;

            const isSingleCharacter = charLengthAt(s, 0) === s.length;
            if (s.length !== 0 && (key.name !== undefined || escaped)) {
                this.onKey(key);
            } else if (isSingleCharacter) {
                this.onKey(key);
            }
        }
    }
}

function charLengthAt(text: string, index: number): number {
    if (text.length <= index) return 1;
    return text.codePointAt(index)! >= FIRST_ASTRAL_CODE_POINT ? 2 : 1;
}

const XTERM_GNOME_FUNCTION_KEY_NAMES: Readonly<Record<string, string>> = {
    "[P": "f1", "[Q": "f2", "[R": "f3", "[S": "f4",
    "OP": "f1", "OQ": "f2", "OR": "f3", "OS": "f4",
};
const XTERM_RXVT_FUNCTION_KEY_NAMES: Readonly<Record<string, string>> = {
    "[11~": "f1", "[12~": "f2", "[13~": "f3", "[14~": "f4",
};
const BRACKETED_PASTE_NAMES: Readonly<Record<string, string>> = {
    "[200~": "paste-start", "[201~": "paste-end",
};
const CYGWIN_LIBUV_FUNCTION_KEY_NAMES: Readonly<Record<string, string>> = {
    "[[A": "f1", "[[B": "f2", "[[C": "f3", "[[D": "f4", "[[E": "f5",
};
const COMMON_FUNCTION_KEY_NAMES: Readonly<Record<string, string>> = {
    "[15~": "f5", "[17~": "f6", "[18~": "f7", "[19~": "f8", "[20~": "f9", "[21~": "f10", "[23~": "f11", "[24~": "f12",
};
const XTERM_GNOME_CURSOR_KEY_NAMES: Readonly<Record<string, string>> = {
    "[A": "up", "[B": "down", "[C": "right", "[D": "left", "[E": "clear", "[F": "end", "[H": "home",
    "OA": "up", "OB": "down", "OC": "right", "OD": "left", "OE": "clear", "OF": "end", "OH": "home",
};
const XTERM_RXVT_EDITING_KEY_NAMES: Readonly<Record<string, string>> = {
    "[1~": "home", "[2~": "insert", "[3~": "delete", "[4~": "end", "[5~": "pageup", "[6~": "pagedown",
};
const PUTTY_PAGE_KEY_NAMES: Readonly<Record<string, string>> = {
    "[[5~": "pageup", "[[6~": "pagedown",
};
const RXVT_HOME_END_NAMES: Readonly<Record<string, string>> = {
    "[7~": "home", "[8~": "end",
};

const NAMES_BY_CODE: Readonly<Record<string, string>> = {
    ...XTERM_GNOME_FUNCTION_KEY_NAMES,
    ...XTERM_RXVT_FUNCTION_KEY_NAMES,
    ...BRACKETED_PASTE_NAMES,
    ...CYGWIN_LIBUV_FUNCTION_KEY_NAMES,
    ...COMMON_FUNCTION_KEY_NAMES,
    ...XTERM_GNOME_CURSOR_KEY_NAMES,
    ...XTERM_RXVT_EDITING_KEY_NAMES,
    ...PUTTY_PAGE_KEY_NAMES,
    ...RXVT_HOME_END_NAMES,
};

const RXVT_NAMES_WITH_MODIFIER_BY_CODE: Readonly<Record<string, {name: string, modifier: "shift" | "ctrl"}>> = {
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
    if (Object.prototype.hasOwnProperty.call(RXVT_NAMES_WITH_MODIFIER_BY_CODE, code)) {
        const named = RXVT_NAMES_WITH_MODIFIER_BY_CODE[code];
        key.name = named.name;
        key[named.modifier] = true;
        return;
    }
    key.name = UNNAMED_ESCAPE_CODE_NAME;
}
