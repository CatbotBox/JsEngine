/** Micro-test: round-trip wake latency main->worker->main via Atomics under this runtime. */
import {Worker} from "worker_threads";

const sab = new SharedArrayBuffer(16);
const ctrl = new Int32Array(sab);

const source = `
const {workerData} = require('worker_threads');
const ctrl = new Int32Array(workerData);
let last = Atomics.load(ctrl, 0);
for (;;) {
    Atomics.wait(ctrl, 0, last);
    const v = Atomics.load(ctrl, 0);
    if (v === last) continue;
    last = v;
    if (v < 0) break;
    Atomics.add(ctrl, 1, 1);
    Atomics.notify(ctrl, 1);
}
`;

const worker = new Worker(source, {eval: true, workerData: sab});
worker.unref();

setTimeout(() => {
    const N = 200;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
        const expect = i + 1;
        Atomics.add(ctrl, 0, 1);
        Atomics.notify(ctrl, 0);
        while (Atomics.load(ctrl, 1) < expect) {
            Atomics.wait(ctrl, 1, Atomics.load(ctrl, 1), 50);
        }
    }
    const ms = performance.now() - start;
    console.log(`round-trip avg: ${(ms / N * 1000).toFixed(1)} us`);

    // Same but main thread spins instead of Atomics.wait
    const start2 = performance.now();
    for (let i = 0; i < N; i++) {
        const expect = N + i + 1;
        Atomics.add(ctrl, 0, 1);
        Atomics.notify(ctrl, 0);
        while (Atomics.load(ctrl, 1) < expect) { /* spin */ }
    }
    const ms2 = performance.now() - start2;
    console.log(`round-trip avg (main spins): ${(ms2 / N * 1000).toFixed(1)} us`);

    Atomics.store(ctrl, 0, -1);
    Atomics.notify(ctrl, 0);
    void worker.terminate();
}, 300);
