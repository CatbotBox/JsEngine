import {app, BrowserWindow, Menu, protocol} from "electron";
import {existsSync, readFileSync} from "fs";
import {readFile, writeFile} from "fs/promises";
import {join} from "path";
import {contentTypeOf, distFileFor, ISOLATION_HEADERS} from "../../../scripts/webDistFiles";

const SCHEME = "app";
const HOST = "bundle";
const SMOKE_SETTLE_MS = 3000;
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 800;
const HTTP_NOT_FOUND = 404;
const BITMAP_BYTES_PER_PIXEL = 4;
const ARGV_APP_ARGS_START_UNPACKAGED = 2;
const ARGV_APP_ARGS_START_PACKAGED = 1;
const AS_USER_GESTURE = true;

export interface PackagedLaunch {
    readonly page: string;
}

const args = process.argv.slice(process.defaultApp ? ARGV_APP_ARGS_START_UNPACKAGED : ARGV_APP_ARGS_START_PACKAGED);
const flagValue = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
};

function packagedLaunch(): PackagedLaunch | undefined {
    const path = join(app.getAppPath(), "launch.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as PackagedLaunch : undefined;
}

const distDirectory = flagValue("dist") ?? join(app.getAppPath(), "web");
const page = flagValue("page") ?? packagedLaunch()?.page ?? "index.html";
const smoke = args.includes("--smoke");
const screenshotPath = flagValue("screenshot");
const MIN_DRAWN_FRACTION = 0.01;

protocol.registerSchemesAsPrivileged([
    {scheme: SCHEME, privileges: {standard: true, secure: true, supportFetchAPI: true}},
]);

async function respond(request: Request): Promise<Response> {
    const path = distFileFor(distDirectory, new URL(request.url).pathname);
    if (path === undefined) return new Response("Not found", {status: HTTP_NOT_FOUND, headers: ISOLATION_HEADERS});
    return new Response(new Uint8Array(await readFile(path)), {
        headers: {...ISOLATION_HEADERS, "Content-Type": contentTypeOf(path)},
    });
}

function drawnFraction(bitmap: Buffer): number {
    let drawn = 0;
    for (let offset = 0; offset < bitmap.length; offset += BITMAP_BYTES_PER_PIXEL) {
        if (bitmap[offset] !== bitmap[0] || bitmap[offset + 1] !== bitmap[1] || bitmap[offset + 2] !== bitmap[2]) drawn++;
    }
    return drawn / (bitmap.length / BITMAP_BYTES_PER_PIXEL);
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

async function pressPlay(window: BrowserWindow): Promise<void> {
    await window.webContents.executeJavaScript(`document.getElementById("play")?.click()`, AS_USER_GESTURE);
}

async function openWindow(): Promise<void> {
    protocol.handle(SCHEME, respond);
    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX, backgroundColor: "#000000", show: !smoke});
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
