import {renderBackendFromQuery} from "./worldWorkerProtocol";
import type {RenderBackend} from "./worldWorkerProtocol";

const MODULE_SCRIPT_TYPE = "module";

export interface RenderBackendScriptOptions {
    readonly defaultBackend?: RenderBackend;
}

export function loadRenderBackendScript(scriptsByBackend: Readonly<Record<RenderBackend, string>>, options: RenderBackendScriptOptions = {}): void {
    const script = document.createElement("script");
    script.type = MODULE_SCRIPT_TYPE;
    script.src = scriptsByBackend[renderBackendFromQuery(location.search, options.defaultBackend)];
    document.body.append(script);
}
