import {KEEP_MANIFEST_KEY, PROJECT_MANIFEST_FILE} from "../project/projectManifest";

export type UnregisteredTypeRole = "component" | "resource";

export function unregisteredTypeMessage(role: UnregisteredTypeRole, typeName: string): string {
    return `the ${role} type "${typeName}" is not registered: register its schema, or, if only code names it, `
        + `add "${typeName}" to "${KEEP_MANIFEST_KEY}" in ${PROJECT_MANIFEST_FILE} and run jsengine generate`;
}
