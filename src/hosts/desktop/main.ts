import {app, BrowserWindow, dialog, Menu, protocol, screen, shell} from "electron";
import {existsSync, readFileSync} from "fs";
import {readFile, writeFile} from "fs/promises";
import {join} from "path";
import {contentTypeOf, distFileFor, ISOLATION_HEADERS} from "./webDistFiles";
import {createProjectServer, locateBun} from "./projectServer";
import {nextZoomFactor, storedZoomFactor, zoomCommandOf, zoomSettingsText} from "./windowZoom";

const SCHEME = "app";
const HOST = "bundle";
const SMOKE_SETTLE_MS = 3000;
const EDITOR_READY_TIMEOUT_MS = 120_000;
const EDITOR_READY_POLL_MS = 250;
const RENDER_BACKEND_SCRIPT_TIMEOUT_MS = 10_000;
const RENDER_BACKEND_SCRIPT_POLL_MS = 50;
const EDITOR_LOADING_STATE = "loading";
const EDITOR_READY_STATE = "ready";
const MIN_WINDOW_WIDTH_PX = 1280;
const MIN_WINDOW_HEIGHT_PX = 800;
const WINDOW_WORK_AREA_FRACTION = 0.8;
const HTTP_NOT_FOUND = 404;
const BITMAP_BYTES_PER_PIXEL = 4;
const ARGV_APP_ARGS_START_UNPACKAGED = 2;
const ARGV_APP_ARGS_START_PACKAGED = 1;
const AS_USER_GESTURE = true;
const WINDOW_SETTINGS_FILE = "window-settings.json";
const LEAVE_PAGE_BUTTONS = ["Leave", "Stay"];
const LEAVE_PAGE_INDEX = 0;
const STAY_ON_PAGE_INDEX = 1;
const LEAVE_PAGE_TITLE = "Unsaved changes";
const LEAVE_PAGE_MESSAGE = "This page has unsaved changes. Leave and lose them?";

export interface PackagedLaunch {
    readonly page: string;
    readonly title: string;
    readonly iconFile: string;
}

interface PreventableEvent {
    preventDefault(): void;
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
const launch = packagedLaunch();
const page = flagValue("page") ?? launch?.page ?? "index.html";
const smoke = args.includes("--smoke");
const screenshotPath = flagValue("screenshot");
const MIN_DRAWN_PIXELS = 256;
const DISPLAY_CANVAS_SELECTOR = "#terminal canvas, #viewport canvas, [data-editor-viewport] canvas";
const repoRoot = flagValue("repo");
let mainWindow: BrowserWindow | undefined;
const projectServer = createProjectServer({
    repoRoot,
    bun: locateBun(flagValue("bun")),
    browse: false,
    pickFolder: async () => {
        const options = {title: "Open a JsEngine project folder", properties: ["openDirectory" as const, "createDirectory" as const]};
        const result = mainWindow === undefined ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(mainWindow, options);
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    },
    showInFolder: async path => shell.showItemInFolder(path),
});

protocol.registerSchemesAsPrivileged([
    {scheme: SCHEME, privileges: {standard: true, secure: true, supportFetchAPI: true}},
]);

async function respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (projectServer.handles(url)) return await projectServer.handle(request);
    const path = distFileFor(distDirectory, url.pathname);
    if (path === undefined) return new Response("Not found", {status: HTTP_NOT_FOUND, headers: ISOLATION_HEADERS});
    return new Response(new Uint8Array(await readFile(path)), {
        headers: {...ISOLATION_HEADERS, "Content-Type": contentTypeOf(path)},
    });
}

function drawnPixelCount(bitmap: Buffer): number {
    let drawn = 0;
    for (let offset = 0; offset < bitmap.length; offset += BITMAP_BYTES_PER_PIXEL) {
        if (bitmap[offset] !== bitmap[0] || bitmap[offset + 1] !== bitmap[1] || bitmap[offset + 2] !== bitmap[2]) drawn++;
    }
    return drawn;
}

function sleep(ms: number): Promise<void> {
    return new Promise(done => setTimeout(done, ms));
}

async function editorStateOf(window: BrowserWindow): Promise<string | undefined> {
    return await window.webContents.executeJavaScript("document.documentElement.dataset.editorState") as string | undefined;
}

async function waitWhileEditorLoads(window: BrowserWindow): Promise<void> {
    const deadline = Date.now() + EDITOR_READY_TIMEOUT_MS;
    while (await editorStateOf(window) === EDITOR_LOADING_STATE && Date.now() < deadline) await sleep(EDITOR_READY_POLL_MS);
}

async function smokeTest(window: BrowserWindow, pageErrors: string[]): Promise<void> {
    await waitWhileEditorLoads(window);
    await sleep(SMOKE_SETTLE_MS);
    const editorState = await editorStateOf(window);
    const report = await window.webContents.executeJavaScript(`(() => {
        const canvas = document.querySelector(${JSON.stringify(DISPLAY_CANVAS_SELECTOR)});
        return {
            crossOriginIsolated,
            canvas: canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0,
            renderBackend: document.documentElement.dataset.renderBackend,
        };
    })()`) as {crossOriginIsolated: boolean, canvas: boolean, renderBackend: string | undefined};
    const image = await window.webContents.capturePage();
    if (screenshotPath !== undefined) await writeFile(screenshotPath, image.toPNG());
    const drawnPixels = drawnPixelCount(image.toBitmap());
    const editorReady = editorState === undefined || editorState === EDITOR_READY_STATE;
    const passed = report.crossOriginIsolated && report.canvas && editorReady && drawnPixels >= MIN_DRAWN_PIXELS && pageErrors.length === 0;
    console.log(JSON.stringify({page, ...report, editorState, drawnPixels, pageErrors, passed}));
    app.exit(passed ? 0 : 1);
}

async function renderBackendScriptPending(window: BrowserWindow): Promise<boolean> {
    return await window.webContents.executeJavaScript(
        `document.getElementById("play") !== null && document.documentElement.dataset.renderBackend === undefined`) as boolean;
}

async function waitForRenderBackendScript(window: BrowserWindow): Promise<void> {
    const deadline = Date.now() + RENDER_BACKEND_SCRIPT_TIMEOUT_MS;
    while (await renderBackendScriptPending(window) && Date.now() < deadline) await sleep(RENDER_BACKEND_SCRIPT_POLL_MS);
}

async function pressPlay(window: BrowserWindow): Promise<void> {
    await waitForRenderBackendScript(window);
    await window.webContents.executeJavaScript(`document.getElementById("play")?.click()`, AS_USER_GESTURE);
}

function initialWindowSize(): {readonly width: number, readonly height: number} {
    const workArea = screen.getPrimaryDisplay().workAreaSize;
    const fitted = (minimum: number, available: number): number => Math.min(available, Math.max(minimum, Math.round(available * WINDOW_WORK_AREA_FRACTION)));
    return {width: fitted(MIN_WINDOW_WIDTH_PX, workArea.width), height: fitted(MIN_WINDOW_HEIGHT_PX, workArea.height)};
}

function windowSettingsPath(): string {
    return join(app.getPath("userData"), WINDOW_SETTINGS_FILE);
}

function loadZoomFactor(): number {
    const path = windowSettingsPath();
    return storedZoomFactor(existsSync(path) ? readFileSync(path, "utf8") : undefined);
}

function handleZoomShortcuts(window: BrowserWindow): void {
    window.webContents.on("before-input-event", (event, input) => {
        const command = zoomCommandOf(input);
        if (command === undefined) return;
        event.preventDefault();
        const zoomFactor = nextZoomFactor(window.webContents.getZoomFactor(), command);
        window.webContents.setZoomFactor(zoomFactor);
        void writeFile(windowSettingsPath(), zoomSettingsText(zoomFactor));
    });
}

function confirmLeavingUnsavedPages(window: BrowserWindow): void {
    window.webContents.on("will-prevent-unload", event => {
        const choice = dialog.showMessageBoxSync(window, {
            type: "question",
            buttons: LEAVE_PAGE_BUTTONS,
            defaultId: STAY_ON_PAGE_INDEX,
            cancelId: STAY_ON_PAGE_INDEX,
            title: LEAVE_PAGE_TITLE,
            message: LEAVE_PAGE_MESSAGE,
        });
        if (choice === LEAVE_PAGE_INDEX) event.preventDefault();
    });
}

async function openWindow(): Promise<void> {
    protocol.handle(SCHEME, respond);
    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({
        ...initialWindowSize(),
        center: true,
        backgroundColor: "#000000",
        show: !smoke,
        title: launch?.title,
        icon: launch === undefined ? undefined : join(app.getAppPath(), launch.iconFile),
        webPreferences: {zoomFactor: smoke ? undefined : loadZoomFactor()},
    });
    mainWindow = window;
    handleZoomShortcuts(window);
    confirmLeavingUnsavedPages(window);
    if (launch !== undefined) window.on("page-title-updated", (event: PreventableEvent) => event.preventDefault());
    const pageErrors: string[] = [];
    window.webContents.on("console-message", event => {
        if (event.level === "error") pageErrors.push(event.message);
    });
    await window.loadURL(`${SCHEME}://${HOST}/${page}`);
    await pressPlay(window);
    if (smoke) await smokeTest(window, pageErrors);
}

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => projectServer.close());
void app.whenReady().then(openWindow);
