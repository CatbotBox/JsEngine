import {isRenderBackendKind} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";

const QUERY_SEPARATOR = "?";
const BACKEND_QUERY_PARAMETER = "backend";

export function requestedRenderBackend(page: string): RenderBackendKind | undefined {
    const queryStart = page.indexOf(QUERY_SEPARATOR);
    if (queryStart < 0) return undefined;
    const requested = new URLSearchParams(page.slice(queryStart)).get(BACKEND_QUERY_PARAMETER)?.trim();
    return isRenderBackendKind(requested) ? requested : undefined;
}

export function renderBackendMatches(requested: RenderBackendKind | undefined, rendered: string | undefined): boolean {
    return requested === undefined || requested === rendered;
}
