import {spawnSync} from "child_process";
import {readdirSync} from "fs";
import {join, relative, resolve} from "path";

const ROOT = resolve(__dirname, "..");
const TESTS = join(ROOT, "tests");
const INTEGRATION_SUFFIX = ".integration.ts";

const files = readdirSync(TESTS).filter(name => name.endsWith(INTEGRATION_SUFFIX)).sort().map(name => join(TESTS, name));
if (files.length === 0) {
    console.error(`no *${INTEGRATION_SUFFIX} files found under tests/`);
    process.exit(1);
}

const failed: string[] = [];
for (const file of files) {
    const name = relative(ROOT, file).replace(/\\/g, "/");
    console.log(`=== ${name}`);
    const result = spawnSync(process.execPath, [...process.execArgv, file], {cwd: ROOT, stdio: "inherit"});
    if (result.status !== 0) failed.push(name);
}

if (failed.length > 0) {
    console.error(`${failed.length} of ${files.length} integration tests failed: ${failed.join(", ")}`);
    process.exit(1);
}
console.log(`all ${files.length} integration tests passed`);
