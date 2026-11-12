const NOT_A_TERMINAL_EXIT_CODE = 1;

export function exitUnlessInteractiveTerminal(demoName: string): void {
    if (process.stdin.isTTY === true && process.stdout.isTTY === true) return;
    process.stderr.write(`${demoName} needs an interactive terminal (stdin and stdout must be a TTY); run it directly in a terminal, not through a pipe.\n`);
    process.exit(NOT_A_TERMINAL_EXIT_CODE);
}
