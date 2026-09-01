/**
 * Tier 3 candidates: two places where an older data shape survived the move to
 * the current allocation-free conventions. Both were deliberately left alone
 * until measured, because the repo's own history says shape rewrites usually
 * do not pay (see the ArenaOctree result reverted in commit 46b8ef0).
 *
 *   A. Children._children: Set<Entity>   -> dense array + swap-remove
 *   B. ConsoleImage.recalculatePixels()  -> reuse row arrays instead of
 *                                           allocating one per row per frame
 *
 * Run: bun bench/tier3.bench.ts
 */
import {Entity} from "../src/js_engine/core/entity";
import {Ansi} from "../src/js_engine/rendering/console/ansi";

// performance.now(), not Date.now(): the Children workload is sub-microsecond per
// iteration and Date.now()'s 1ms resolution turned the ratios into noise
// (6.00x from 0.0001/0.0000, and one Infinity). Iterations are also scaled so
// every measurement spans >=50ms of real work.
function bench(label: string, iters: number, fn: () => void): number {
    for (let i = 0; i < Math.min(iters, 1000); i++) fn(); // warm
    let total = 0;
    let runs = 0;
    // Repeat until the sample is long enough to be meaningful, then take the best
    // of the batches (least disturbed by GC / scheduler).
    let best = Infinity;
    while (total < 50 || runs < 3) {
        const t0 = performance.now();
        for (let i = 0; i < iters; i++) fn();
        const ms = performance.now() - t0;
        total += ms;
        runs++;
        if (ms < best) best = ms;
        if (runs > 50) break;
    }
    const per = best / iters;
    console.log("  " + label.padEnd(34) + (per * 1000).toFixed(4) + " us/iter");
    return per;
}

// ---------------------------------------------------------------- A. Children

/** Dense array + swap-remove, mirroring EntityArchetype's own storage idiom. */
class ArrayChildren {
    private readonly _children: Entity[] = [];
    public get children(): readonly Entity[] { return this._children; }
    public add(e: Entity): void { if (this._children.indexOf(e) < 0) this._children.push(e); }
    public has(e: Entity): boolean { return this._children.indexOf(e) >= 0; }
    public remove(e: Entity): void {
        const i = this._children.indexOf(e);
        if (i < 0) return;
        const last = this._children.length - 1;
        this._children[i] = this._children[last];
        this._children.length = last;
    }
}

let sink = 0;

function childrenBench() {
    console.log("\nA. Children: Set<Entity> vs dense array");
    console.log("   workload per iter = iterate every child (both sync systems do this each");
    console.log("   frame) + one membership test per child (HierarchySyncSystem does this).\n");

    for (const n of [2, 4, 8, 32, 128]) {
        const ents: Entity[] = [];
        // entities are branded integers now; distinct numbers preserve the
        // identity-comparison workload this bench measures
        for (let i = 0; i < n; i++) ents.push((i + 1) as unknown as Entity);

        const asSet = new Set(ents);
        const asArr = new ArrayChildren();
        for (const e of ents) asArr.add(e);

        const iters = Math.max(20_000, 2_000_000 / n | 0);
        console.log(` n=${n}`);
        const s = bench("Set: forEach + has", iters, () => {
            asSet.forEach(c => { if (asSet.has(c)) sink++; });
        });
        const a = bench("array: for + indexOf", iters, () => {
            const cs = asArr.children;
            for (let i = 0; i < cs.length; i++) { if (asArr.has(cs[i])) sink++; }
        });
        const aIter = bench("array: for, no membership", iters, () => {
            const cs = asArr.children;
            for (let i = 0; i < cs.length; i++) sink += cs[i] === undefined ? 1 : 0;
        });
        const sIter = bench("Set: forEach, no membership", iters, () => {
            asSet.forEach(c => { sink += c === undefined ? 1 : 0; });
        });
        console.log("   -> with membership: " + (s / a).toFixed(2) + "x  |  iterate only: " +
            (sIter / aIter).toFixed(2) + "x  (>1 means array wins)\n");
    }
}

// ------------------------------------------------------------ B. ConsoleImage

const CSI_RE = /\x1B\[[0-9;]*m/y;

/** Current: allocates a fresh array per row, per call. */
function splitAlloc(line: string, transparentChar: string | undefined): (string | undefined)[] {
    const ESC = "\x1b";
    const out: (string | undefined)[] = [];
    let i = 0, carry = "";
    while (i < line.length) {
        const ch = line[i];
        if (ch === ESC) {
            CSI_RE.lastIndex = i;
            const m = CSI_RE.exec(line);
            if (m) { carry += m[0]; i += m[0].length; continue; }
            carry += ch; i++; continue;
        }
        if (ch === transparentChar) out.push(undefined);
        else out.push(Ansi.control.reset + carry + ch + Ansi.control.reset);
        i++;
    }
    return out;
}

/** Candidate: fill a caller-owned row, matching the out-param convention. */
function splitInto(out: (string | undefined)[], line: string, transparentChar: string | undefined): void {
    const ESC = "\x1b";
    let i = 0, carry = "", n = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === ESC) {
            CSI_RE.lastIndex = i;
            const m = CSI_RE.exec(line);
            if (m) { carry += m[0]; i += m[0].length; continue; }
            carry += ch; i++; continue;
        }
        if (ch === transparentChar) out[n++] = undefined;
        else out[n++] = Ansi.control.reset + carry + ch + Ansi.control.reset;
        i++;
    }
    out.length = n;
}

function makeImage(w: number, h: number, ansiEvery: number): string[] {
    const rows: string[] = [];
    for (let y = 0; y < h; y++) {
        let s = "";
        for (let x = 0; x < w; x++) {
            if (ansiEvery > 0 && x % ansiEvery === 0) s += "\x1b[38;5;" + (x % 250) + "m";
            s += String.fromCharCode(65 + ((x + y) % 26));
        }
        rows.push(s);
    }
    return rows;
}

function consoleImageBench() {
    console.log("\nB. ConsoleImage.recalculatePixels: allocate rows vs reuse rows");
    console.log("   Runs on every `image` assignment — once per entity per frame for a");
    console.log("   colour fade, which is exactly CASCADE 1 in boundsCascade.bench.\n");

    for (const [w, h, ansiEvery, label] of [
        [20, 5, 0, "20x5 sprite, no ansi"],
        [20, 5, 4, "20x5 sprite, ansi-heavy"],
        [240, 64, 0, "240x64 fullscreen, no ansi"],
        [240, 64, 8, "240x64 fullscreen, ansi-heavy"],
    ] as [number, number, number, string][]) {
        const img = makeImage(w, h, ansiEvery);
        const iters = w * h > 5000 ? 300 : 20000;
        console.log(" " + label);

        const pixelsA: (string | undefined)[][] = [];
        const a = bench("alloc a row per row", iters, () => {
            pixelsA.length = img.length;
            for (let r = 0; r < img.length; r++) pixelsA[r] = splitAlloc(img[r], " ");
            sink += pixelsA.length;
        });

        const pixelsB: (string | undefined)[][] = [];
        const b = bench("reuse rows (out-param)", iters, () => {
            const prev = pixelsB.length;
            pixelsB.length = img.length;
            for (let r = prev; r < img.length; r++) pixelsB[r] = [];
            for (let r = 0; r < img.length; r++) splitInto(pixelsB[r], img[r], " ");
            sink += pixelsB.length;
        });
        console.log("   -> " + (a / b).toFixed(2) + "x  (>1 means reuse wins)\n");
    }
}

childrenBench();
consoleImageBench();
console.log("sink=" + sink);
