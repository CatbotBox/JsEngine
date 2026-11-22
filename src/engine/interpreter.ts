import {optionalFeature} from "./platform/platform";

export type SupportedInterpreters =
    "Node" |
    "Bun" |
    "Browser" |
    "Unknown"

export function currentInterpreter(): SupportedInterpreters {
    const nodeCompatible = optionalFeature("node", (): SupportedInterpreters | undefined => {
        const versions = typeof process !== "undefined" ? process.versions : undefined;
        if (versions?.bun) return "Bun";
        if (versions?.node) return "Node";
        return undefined;
    });
    if (nodeCompatible !== undefined) return nodeCompatible;
    if (optionalFeature("dom", () => typeof navigator !== "undefined") === true) return "Browser";
    console.warn("Running in an unknown environment");
    return "Unknown";
}
