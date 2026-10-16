export type SupportedInterpreters =
    "Node" |
    "Bun" |
    "Browser" |
    "Unknown"

const versions = typeof process !== "undefined" ? process.versions : undefined;

let interpreter: SupportedInterpreters
if (versions?.bun) {
    interpreter = "Bun";
} else if (versions?.node) {
    interpreter = "Node";
} else if (typeof navigator !== "undefined") {
    interpreter = "Browser";
} else {
    console.warn("Running in an unknown environment");
    interpreter = "Unknown"
}

export const CurrentInterpreter: SupportedInterpreters = interpreter;
