/**
 * Electron main process: serves the browser bundle (web/dist) over the privileged `app://` scheme
 * with COOP/COEP, so the page is cross-origin isolated exactly as under scripts/serveWeb.ts, and
 * opens it in a window. Bundled to window/dist/main.js and started by scripts/window.ts as
 * `electron main.js <web/dist> <page> [--smoke]`.
 *
 * `--smoke` loads the page hidden, waits SMOKE_SETTLE_MS, prints one JSON line (isolation, the
 * terminal element, how much of the window is drawn, page errors) and exits non-zero if anything
 * is missing. `--screenshot=<file.png>` additionally saves what the window showed.
 */
import {app, BrowserWindow, Menu, protocol} from "electron";
import {readFile, writeFile} from "fs/promises";
import {contentTypeOf, distFileFor, ISOLATION_HEADERS} from "../scripts/webDistFiles";

const SCHEME = "app";
const HOST = "bundle";
const SMOKE_SETTLE_MS = 3000;

const [distDirectory, page, ...flags] = process.argv.slice(2);
const smoke = flags.includes("--smoke");
const screenshotPath = flags.find(flag => flag.startsWith("--screenshot="))?.slice("--screenshot=".length);
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

async function openWindow(): Promise<void> {
    protocol.handle(SCHEME, respond);
    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({width: 1280, height: 800, backgroundColor: "#000000", show: !smoke});
    const pageErrors: string[] = [];
    window.webContents.on("console-message", event => {
        if (event.level === "error") pageErrors.push(event.message);
    });
    await window.loadURL(`${SCHEME}://${HOST}/${page}`);
    if (smoke) await smokeTest(window, pageErrors);
}

app.on("window-all-closed", () => app.quit());
void app.whenReady().then(openWindow);
