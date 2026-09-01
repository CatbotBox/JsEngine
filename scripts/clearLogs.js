// Portable replacement for `rm -rf logs/*` — the old script only worked in a
// POSIX shell, so `npm run clear-logs` failed under cmd.exe on Windows.
// Plain CommonJS so it runs identically under node and bun.
const fs = require("fs");
const path = require("path");

for (const dir of ["logs", "crash-logs"]) {
    const full = path.join(__dirname, "..", dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full)) {
        fs.rmSync(path.join(full, entry), {recursive: true, force: true});
    }
}
