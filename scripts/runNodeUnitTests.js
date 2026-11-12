const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src");
const demo = path.join(__dirname, "..", "demo");

function collect(dir, out) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full, out);
        else if (entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
}

const files = [...collect(src, []).sort(), ...collect(demo, []).sort()];
if (files.length === 0) {
    console.error("no *.test.ts files found under src/ or demo/");
    process.exit(1);
}
for (const file of files) require(file);
