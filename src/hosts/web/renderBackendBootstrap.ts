import {renderBackendFromQuery} from "./worldWorkerProtocol";
import type {RenderBackend} from "./worldWorkerProtocol";

const MODULE_SCRIPT_TYPE = "module";

export function loadRenderBackendScript(scriptsByBackend: Readonly<Record<RenderBackend, string>>): void {
    const script = document.createElement("script");
    script.type = MODULE_SCRIPT_TYPE;
    script.src = scriptsByBackend[renderBackendFromQuery(location.search)];
    document.body.append(script);
}
