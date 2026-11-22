import {FIRST_SCENE_ENTITY_ID, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene/sceneDocument";
import {sceneDocumentText} from "./prefabInstancePaths";

export interface ScriptTemplate {
    readonly fileStem: string;
    readonly componentName: string;
    readonly systemName: string;
    readonly text: string;
}

export const SCRIPT_EXTENSION = ".ts";
export const DEFAULT_PREFAB_NAME = "New Prefab";
export const DEFAULT_SCRIPT_NAME = "NewScript";

const ENGINE_CORE_MODULE = "@jsengine/engine/core";
const SYSTEM_SUFFIX = "System";
const WORD_SEPARATORS = /[^\p{L}\p{Nd}]+/u;
const STARTS_WITH_DIGIT = /^[0-9]/;
const DIGIT_PREFIX = "Script";
const LINE_BREAK = "\n";
const INDENT = "    ";

function capitalized(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function lowerFirst(word: string): string {
    return word.charAt(0).toLowerCase() + word.slice(1);
}

export function scriptComponentName(name: string): string {
    const words = name.split(WORD_SEPARATORS).filter(word => word.length > 0);
    let identifier = words.map(capitalized).join("");
    if (identifier.endsWith(SYSTEM_SUFFIX) && identifier.length > SYSTEM_SUFFIX.length) identifier = identifier.slice(0, -SYSTEM_SUFFIX.length);
    if (identifier === SYSTEM_SUFFIX || identifier.length === 0) identifier = DEFAULT_SCRIPT_NAME;
    return STARTS_WITH_DIGIT.test(identifier) ? DIGIT_PREFIX + identifier : identifier;
}

export function scriptTemplate(name: string): ScriptTemplate {
    const componentName = scriptComponentName(name);
    const systemName = componentName + SYSTEM_SUFFIX;
    const queryField = `_${lowerFirst(componentName)}Entities`;
    const lines = [
        `import {Component, System} from "${ENGINE_CORE_MODULE}";`,
        "",
        `export class ${componentName} extends Component {`,
        "}",
        "",
        `export class ${systemName} extends System {`,
        `${INDENT}private readonly ${queryField} = this.createEntityQuery([${componentName}]);`,
        "",
        `${INDENT}protected onCreate(): void {`,
        `${INDENT}${INDENT}this.requireAllForUpdate(this.${queryField});`,
        `${INDENT}}`,
        "",
        `${INDENT}onUpdate(): void {`,
        `${INDENT}}`,
        "}",
        "",
    ];
    return {fileStem: lowerFirst(componentName), componentName, systemName, text: lines.join(LINE_BREAK)};
}

export function prefabTemplateText(rootName: string): string {
    return sceneDocumentText({
        format: SCENE_DOCUMENT_FORMAT,
        version: SCENE_DOCUMENT_VERSION,
        entities: [{id: FIRST_SCENE_ENTITY_ID, name: rootName, enabled: true, components: {}}],
    });
}
