/**
 * Every key string the engine recognises, mapped to the canonical name you pass
 * to whenKeyDown()/keyDown(). Values are exactly what lands in KeyEvent.id.
 *
 * NOTE ON MODIFIERS: terminals never report a bare Shift/Ctrl/Alt press on its
 * own — a modifier only arrives as a flag on some OTHER key event. So Shift/Ctrl/
 * Alt here match "was this modifier held during a key event", not a standalone tap.
 *
 * NOTE ON PUNCTUATION: symbol keys (`/`, `-`, `=`, etc.) have no readline name;
 * pass the literal character instead, e.g. whenKeyDown('/', ...). Digits/letters
 * work either way (Key.A === 'a', Key.Num1 === '1').
 */
export enum Key {
    // Letters (Shift+letter still reports the lowercase name, with shift=true)
    A = 'a', B = 'b', C = 'c', D = 'd', E = 'e', F = 'f', G = 'g',
    H = 'h', I = 'i', J = 'j', K = 'k', L = 'l', M = 'm', N = 'n',
    O = 'o', P = 'p', Q = 'q', R = 'r', S = 's', T = 't', U = 'u',
    V = 'v', W = 'w', X = 'x', Y = 'y', Z = 'z',

    // Top-row digits
    Num0 = '0', Num1 = '1', Num2 = '2', Num3 = '3', Num4 = '4',
    Num5 = '5', Num6 = '6', Num7 = '7', Num8 = '8', Num9 = '9',

    // Arrows
    Up = 'up', Down = 'down', Left = 'left', Right = 'right',

    // Navigation & editing
    Space = 'space',
    Enter = 'return',        // most terminals send \r -> 'return' in raw mode
    Tab = 'tab',
    Escape = 'escape',
    Backspace = 'backspace',
    Delete = 'delete',
    Insert = 'insert',
    Home = 'home',
    End = 'end',
    PageUp = 'pageup',
    PageDown = 'pagedown',

    // Function keys
    F1 = 'f1', F2 = 'f2', F3 = 'f3', F4 = 'f4', F5 = 'f5', F6 = 'f6',
    F7 = 'f7', F8 = 'f8', F9 = 'f9', F10 = 'f10', F11 = 'f11', F12 = 'f12',

    // Modifiers (see NOTE ON MODIFIERS above)
    Shift = 'shift',
    Ctrl = 'ctrl',
    Alt = 'alt',
}