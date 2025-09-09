export const Ansi = {
    control: {
        reset: "\x1b[0m",
        bold: "\x1b[1m",
        dim: "\x1b[2m",
        italic: "\x1b[3m",
        underline: "\x1b[4m",
        inverse: "\x1b[7m",
        hidden: "\x1b[8m",
        strikethrough: "\x1b[9m",
    },

    colors: {
        fg: {
            black: "\x1b[30m",
            red: "\x1b[31m",
            green: "\x1b[32m",
            yellow: "\x1b[33m",
            blue: "\x1b[34m",
            magenta: "\x1b[35m",
            cyan: "\x1b[36m",
            white: "\x1b[37m",
            // bright
            brightBlack: "\x1b[90m",
            brightRed: "\x1b[91m",
            brightGreen: "\x1b[92m",
            brightYellow: "\x1b[93m",
            brightBlue: "\x1b[94m",
            brightMagenta: "\x1b[95m",
            brightCyan: "\x1b[96m",
            brightWhite: "\x1b[97m",
        },
        bg: {
            black: "\x1b[40m",
            red: "\x1b[41m",
            green: "\x1b[42m",
            yellow: "\x1b[43m",
            blue: "\x1b[44m",
            magenta: "\x1b[45m",
            cyan: "\x1b[46m",
            white: "\x1b[47m",
            // bright
            brightBlack: "\x1b[100m",
            brightRed: "\x1b[101m",
            brightGreen: "\x1b[102m",
            brightYellow: "\x1b[103m",
            brightBlue: "\x1b[104m",
            brightMagenta: "\x1b[105m",
            brightCyan: "\x1b[106m",
            brightWhite: "\x1b[107m",
        },
    },

    // 256-color (xterm)
    fg256: (n: number) => `\x1b[38;5;${n}m`,
    bg256: (n: number) => `\x1b[48;5;${n}m`,

    // Truecolor (24-bit RGB)
    fgRGB: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
    bgRGB: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,

    cursor: {
        up: (n = 1) => `\x1b[${n}A`,
        down: (n = 1) => `\x1b[${n}B`,
        forward: (n = 1) => `\x1b[${n}C`,
        back: (n = 1) => `\x1b[${n}D`,
        nextLine: (n = 1) => `\x1b[${n}E`,
        prevLine: (n = 1) => `\x1b[${n}F`,
        column: (n: number) => `\x1b[${n}G`,
        position: (row: number, col: number) => `\x1b[${row};${col}H`,
        save: "\x1b[s",
        restore: "\x1b[u",
    },

    screen: {
        clearToEnd: "\x1b[0J",
        clearToStart: "\x1b[1J",
        clearAll: "\x1b[2J",
        clearLine: "\x1b[2K",
    },

    modes: {
        altScreenEnter: "\x1b[?1049h",
        altScreenExit: "\x1b[?1049l",
    },

    strip(str: string): string {
        return str.replace(
            // matches CSI sequences like \x1B[31m, \x1B[0m, etc.
            /\x1B\[[0-9;]*m/g,
            ''
        );

    }
};
