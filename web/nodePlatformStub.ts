import type * as NodePlatform from "../src/js_engine/platform/nodePlatform";

/**
 * Stands in for `platform/nodePlatform.ts` in the browser bundle (see scripts/buildWeb.ts), so no
 * node module is ever reachable from it. Every engine default that would fall back to the node
 * platform throws instead: in a page the platform is always passed explicitly.
 */
function unavailable(name: string): never {
    throw new Error(`${name}() is node-only; in the browser pass a platform explicitly (browserPlatform)`);
}

export const nodePlatform: typeof NodePlatform.nodePlatform = () => unavailable("nodePlatform");
export const nodeDeflate: typeof NodePlatform.nodeDeflate = () => unavailable("nodeDeflate");
export const nodeLogHost: typeof NodePlatform.nodeLogHost = () => unavailable("nodeLogHost");
