export type SupportedInterpreters =
    "Node" |
    "Bun" |
    "Unknown"

let interpreter: SupportedInterpreters
if (process.versions.bun) {
    interpreter = "Bun";
} else if (process.versions.node) {
    interpreter = "Node";
} else {
    console.warn("Running in an unknown environment");
    interpreter = "Unknown"
}

export const CurrentInterpreter: SupportedInterpreters = interpreter;

