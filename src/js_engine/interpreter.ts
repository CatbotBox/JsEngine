export type SupportedInterpreters =
    "Node" |
    "Bun" |
    "Unknown"

const versions = typeof process !== "undefined" ? process.versions : undefined;

let interpreter: SupportedInterpreters
if (versions?.bun) {
    interpreter = "Bun";
} else if (versions?.node) {
    interpreter = "Node";
} else {
    console.warn("Running in an unknown environment");
    interpreter = "Unknown"
}

export const CurrentInterpreter: SupportedInterpreters = interpreter;

