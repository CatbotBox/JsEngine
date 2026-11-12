const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src");
const demo = path.join(__dirname, "..", "demo");
const web = path.join(__dirname, "..", "web");
const RECURSIVE = true;
const TOP_LEVEL_ONLY = false;

function collect(dir, out, recursive = RECURSIVE) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (recursive) collect(full, out);
        } else if (entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
}

const files = [...collect(src, []).sort(), ...collect(demo, []).sort(), ...collect(web, [], TOP_LEVEL_ONLY).sort()];
if (files.length === 0) {
    console.error("no *.test.ts files found under src/, demo/ or web/");
    process.exit(1);
}
for (const file of files) require(file);
