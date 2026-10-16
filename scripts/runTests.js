// Node test entry point: every *.test.ts under src/ and demo/, and directly in web/.
//
// `node --test "src/**/*.test.ts"` was fragile in two ways: it needs glob
// support in --test (node >= 21), and it relies on node forwarding
// `-r ts-node/register/transpile-only` into the child process it spawns per
// test file. Requiring the suites in-process instead needs neither: node:test
// auto-runs top-level suites when the process drains, and sets a non-zero exit
// code if any of them failed.
//
// Run as: node -r ts-node/register/transpile-only scripts/runTests.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "src");
const demo = path.join(__dirname, "..", "demo");
// web/ holds page code and its built sites (web/dist*); only its top-level suites are tests.
const web = path.join(__dirname, "..", "web");

function collect(dir, out, recursive = true) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (recursive) collect(full, out);
        } else if (entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
}

const files = [...collect(root, []).sort(), ...collect(demo, []).sort(), ...collect(web, [], false).sort()];
if (files.length === 0) {
    console.error("no *.test.ts files found under src/, demo/ or web/");
    process.exit(1);
}
for (const file of files) require(file);
