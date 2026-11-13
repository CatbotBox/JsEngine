export enum Key {
    A = 'a', B = 'b', C = 'c', D = 'd', E = 'e', F = 'f', G = 'g',
    H = 'h', I = 'i', J = 'j', K = 'k', L = 'l', M = 'm', N = 'n',
    O = 'o', P = 'p', Q = 'q', R = 'r', S = 's', T = 't', U = 'u',
    V = 'v', W = 'w', X = 'x', Y = 'y', Z = 'z',

    Num0 = '0', Num1 = '1', Num2 = '2', Num3 = '3', Num4 = '4',
    Num5 = '5', Num6 = '6', Num7 = '7', Num8 = '8', Num9 = '9',

    Minus = '-', Equal = '=', BracketLeft = '[', BracketRight = ']', Backslash = '\\',
    Semicolon = ';', Quote = "'", Comma = ',', Period = '.', Slash = '/', Backquote = '`',

    Up = 'up', Down = 'down', Left = 'left', Right = 'right',

    Space = 'space',
    Enter = 'return',
    Tab = 'tab',
    Escape = 'escape',
    Backspace = 'backspace',
    Delete = 'delete',
    Insert = 'insert',
    Home = 'home',
    End = 'end',
    PageUp = 'pageup',
    PageDown = 'pagedown',

    F1 = 'f1', F2 = 'f2', F3 = 'f3', F4 = 'f4', F5 = 'f5', F6 = 'f6',
    F7 = 'f7', F8 = 'f8', F9 = 'f9', F10 = 'f10', F11 = 'f11', F12 = 'f12',

    Shift = 'shift',
    Ctrl = 'ctrl',
    Alt = 'alt',
    Meta = 'meta',
}

export interface CharacterKey {
    readonly key: Key;
    readonly shift: boolean;
}

const UNSHIFTED = false;
const SHIFTED = true;

const LETTER_KEYS: readonly Key[] = [
    Key.A, Key.B, Key.C, Key.D, Key.E, Key.F, Key.G, Key.H, Key.I, Key.J, Key.K, Key.L, Key.M,
    Key.N, Key.O, Key.P, Key.Q, Key.R, Key.S, Key.T, Key.U, Key.V, Key.W, Key.X, Key.Y, Key.Z,
];

const KEYS_TYPING_THEIR_OWN_VALUE: readonly Key[] = [
    ...LETTER_KEYS,
    Key.Num0, Key.Num1, Key.Num2, Key.Num3, Key.Num4, Key.Num5, Key.Num6, Key.Num7, Key.Num8, Key.Num9,
    Key.Minus, Key.Equal, Key.BracketLeft, Key.BracketRight, Key.Backslash,
    Key.Semicolon, Key.Quote, Key.Comma, Key.Period, Key.Slash, Key.Backquote,
];

const US_SHIFTED_CHARACTERS: readonly (readonly [string, Key])[] = [
    ['!', Key.Num1], ['@', Key.Num2], ['#', Key.Num3], ['$', Key.Num4], ['%', Key.Num5],
    ['^', Key.Num6], ['&', Key.Num7], ['*', Key.Num8], ['(', Key.Num9], [')', Key.Num0],
    ['_', Key.Minus], ['+', Key.Equal], ['{', Key.BracketLeft], ['}', Key.BracketRight], ['|', Key.Backslash],
    [':', Key.Semicolon], ['"', Key.Quote], ['<', Key.Comma], ['>', Key.Period], ['?', Key.Slash], ['~', Key.Backquote],
];

const SPACE_CHARACTER = ' ';

function characterKeyTable(): ReadonlyMap<string, CharacterKey> {
    const table = new Map<string, CharacterKey>();
    for (const key of KEYS_TYPING_THEIR_OWN_VALUE) table.set(key, {key, shift: UNSHIFTED});
    for (const key of LETTER_KEYS) table.set(key.toUpperCase(), {key, shift: SHIFTED});
    for (const [character, key] of US_SHIFTED_CHARACTERS) table.set(character, {key, shift: SHIFTED});
    table.set(SPACE_CHARACTER, {key: Key.Space, shift: UNSHIFTED});
    return table;
}

const KEY_BY_CHARACTER = characterKeyTable();

export function keyForCharacter(character: string): CharacterKey | undefined {
    return KEY_BY_CHARACTER.get(character);
}
