import {describe, expect, test} from "../../engine/testing/harness";
import {WORKER_ENTRY_POINT} from "../../engine/platform/platform";
import {nodePlatform} from "./nodePlatform";

describe("node worker factory", () => {
    test("runs a script that only uses its data and port", async () => {
        const workers = nodePlatform().workers!;
        const shared = new Int32Array(new SharedArrayBuffer(4));
        const worker = workers.spawn(`'use strict';
function ${WORKER_ENTRY_POINT}(data, port) {
    Atomics.store(new Int32Array(data.shared), 0, data.value);
    port.onMessage((message) => port.postMessage(message * 2));
}`, {shared: shared.buffer, value: 7});
        worker.unref?.();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const reply = await new Promise<unknown>((resolve, reject) => {
                timeout = setTimeout(() => reject(new Error("worker did not answer")), 10_000);
                worker.onMessage(resolve);
                worker.onError(reject);
                worker.postMessage(21);
            });
            expect(reply).toBe(42);
            expect(Atomics.load(shared, 0)).toBe(7);
        } finally {
            clearTimeout(timeout);
            worker.terminate();
        }
    });
});
