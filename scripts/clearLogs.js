const fs = require("fs");
const path = require("path");

const LOG_DIRECTORIES = ["logs", "crash-logs"];

for (const dir of LOG_DIRECTORIES) {
    const full = path.join(__dirname, "..", dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full)) {
        fs.rmSync(path.join(full, entry), {recursive: true, force: true});
    }
}
