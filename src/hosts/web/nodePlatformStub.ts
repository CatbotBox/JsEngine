import type * as NodePlatform from "../terminal/nodePlatform";

function unavailable(name: string): never {
    throw new Error(`${name}() is node-only; in the browser pass a platform explicitly (browserPlatform)`);
}

export const nodePlatform: typeof NodePlatform.nodePlatform = () => unavailable("nodePlatform");
export const nodeDeflate: typeof NodePlatform.nodeDeflate = () => unavailable("nodeDeflate");
export const nodeLogHost: typeof NodePlatform.nodeLogHost = () => unavailable("nodeLogHost");
