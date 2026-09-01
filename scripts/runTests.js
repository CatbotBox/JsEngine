// Node test entry point.
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

function collect(dir, out) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full, out);
        else if (entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
}

const files = collect(root, []).sort();
if (files.length === 0) {
    console.error("no *.test.ts files found under src/");
    process.exit(1);
}
for (const file of files) require(file);
