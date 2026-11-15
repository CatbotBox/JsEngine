import {pageFromArguments} from "./webDistFiles";
import {buildWeb, bundleMainProcess, electronEnvironment, exitOnFailure, ROOT, WEB_DIST} from "./windowBuild";

async function main(): Promise<void> {
    const page = pageFromArguments("2d");
    if (!process.argv.includes("--no-build")) buildWeb();
    const mainProcess = await bundleMainProcess();
    const electron = require("electron") as string;
    const forwardedFlags = process.argv.filter(arg => arg === "--smoke" || arg.startsWith("--screenshot="));
    const child = Bun.spawn([electron, mainProcess, `--dist=${WEB_DIST}`, `--page=${page}`, `--repo=${ROOT}`, `--bun=${process.execPath}`, ...forwardedFlags], {
        stdio: ["inherit", "inherit", "inherit"],
        env: electronEnvironment(),
    });
    exitOnFailure(await child.exited);
}

void main();
