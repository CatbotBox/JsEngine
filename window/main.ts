/**
 * Electron main process: serves the browser bundle (web/dist) over the privileged `app://` scheme
 * with COOP/COEP, so the page is cross-origin isolated exactly as under scripts/serveWeb.ts, and
 * opens it in a window. Bundled to window/dist/main.js; scripts/window.ts starts it as
 * `electron main.js --dist=<web/dist> --page=<file.html> [--smoke]`, and scripts/packageWindow.ts
 * ships it with the bundle in web/ and the page in launch.json beside it, so the packaged exe
 * needs no arguments (`--page`/`--smoke` still apply).
 *
 * `--smoke` loads the page hidden, waits SMOKE_SETTLE_MS, prints one JSON line (isolation, the
 * terminal element, how much of the window is drawn, page errors) and exits non-zero if anything
 * is missing. `--screenshot=<file.png>` additionally saves what the window showed.
 */
import {app, BrowserWindow, Menu, protocol} from "electron";
import {existsSync, readFileSync} from "fs";
import {readFile, writeFile} from "fs/promises";
import {join} from "path";
import {contentTypeOf, distFileFor, ISOLATION_HEADERS} from "../scripts/webDistFiles";

const SCHEME = "app";
const HOST = "bundle";
const SMOKE_SETTLE_MS = 3000;

/** What scripts/packageWindow.ts writes beside the packaged main.js. */
export interface PackagedLaunch {
    readonly page: string;
}

/** Electron passes its own executable and, unpackaged, the main script before the app arguments. */
const args = process.argv.slice(process.defaultApp ? 2 : 1);
const flagValue = (name: string): string | undefined =>
    args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

function packagedLaunch(): PackagedLaunch | undefined {
    const path = join(app.getAppPath(), "launch.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as PackagedLaunch : undefined;
}

const distDirectory = flagValue("dist") ?? join(app.getAppPath(), "web");
const page = flagValue("page") ?? packagedLaunch()?.page ?? "index.html";
const smoke = args.includes("--smoke");
const screenshotPath = flagValue("screenshot");
/** A blank terminal is all background; a running demo draws well past this. */
const MIN_DRAWN_FRACTION = 0.01;

protocol.registerSchemesAsPrivileged([
    {scheme: SCHEME, privileges: {standard: true, secure: true, supportFetchAPI: true}},
]);

async function respond(request: Request): Promise<Response> {
    const path = distFileFor(distDirectory, new URL(request.url).pathname);
    if (path === undefined) return new Response("Not found", {status: 404, headers: ISOLATION_HEADERS});
    return new Response(new Uint8Array(await readFile(path)), {
        headers: {...ISOLATION_HEADERS, "Content-Type": contentTypeOf(path)},
    });
}

/** The fraction of pixels that differ from the top-left one (the terminal background). */
function drawnFraction(bitmap: Buffer): number {
    let drawn = 0;
    for (let offset = 0; offset < bitmap.length; offset += 4) {
        if (bitmap[offset] !== bitmap[0] || bitmap[offset + 1] !== bitmap[1] || bitmap[offset + 2] !== bitmap[2]) drawn++;
    }
    return drawn / (bitmap.length / 4);
}

async function smokeTest(window: BrowserWindow, pageErrors: string[]): Promise<void> {
    await new Promise(settle => setTimeout(settle, SMOKE_SETTLE_MS));
    const report = await window.webContents.executeJavaScript(
        `({crossOriginIsolated, terminal: document.querySelector(".xterm") !== null})`,
    ) as {crossOriginIsolated: boolean, terminal: boolean};
    const image = await window.webContents.capturePage();
    if (screenshotPath !== undefined) await writeFile(screenshotPath, image.toPNG());
    const drawn = drawnFraction(image.toBitmap());
    const passed = report.crossOriginIsolated && report.terminal && drawn >= MIN_DRAWN_FRACTION && pageErrors.length === 0;
    console.log(JSON.stringify({page, ...report, drawn: Number(drawn.toFixed(3)), pageErrors, passed}));
    app.exit(passed ? 0 : 1);
}

/** A demo page waits behind its `#play` button (web/worldPage.ts); the window opens straight into the demo. */
async function pressPlay(window: BrowserWindow): Promise<void> {
    await window.webContents.executeJavaScript(`document.getElementById("play")?.click()`, true);
}

async function openWindow(): Promise<void> {
    protocol.handle(SCHEME, respond);
    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({width: 1280, height: 800, backgroundColor: "#000000", show: !smoke});
    const pageErrors: string[] = [];
    window.webContents.on("console-message", event => {
        if (event.level === "error") pageErrors.push(event.message);
    });
    await window.loadURL(`${SCHEME}://${HOST}/${page}`);
    await pressPlay(window);
    if (smoke) await smokeTest(window, pageErrors);
}

app.on("window-all-closed", () => app.quit());
void app.whenReady().then(openWindow);
