import {app, BrowserWindow, dialog, Menu, protocol, screen, shell} from "electron";
import type {Details} from "electron";
import {existsSync, mkdtempSync, readFileSync, rmSync} from "fs";
import {access, mkdtemp, readFile, rm, writeFile} from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {contentTypeOf, distFileFor, ISOLATION_HEADERS} from "../../hosts/desktop";
import {createProjectServer, locateBun} from "./projectServer";
import {renderBackendMatches, requestedRenderBackend} from "./smokeBackend";
import {editorSmokeFlows, recoverEditor} from "./editorSmokeFlows";
import {runSmokeFlows, selectFlows, smokeFlowsPassed} from "./smokeFlows";
import type {SmokeFlow, SmokeFlowResult, SmokeHost} from "./smokeFlows";
import type {SmokeInputEvent} from "./smokeInput";
import type {SmokeClock, SmokePage} from "./smokeUi";
import {nextZoomFactor, storedZoomFactor, WINDOW_ZOOM_PATH, ZOOM_FACTORS, zoomCommandOf, zoomFactorOfText, zoomSettingsText} from "../project/windowZoom";
import {EDITOR_VIEWPORT_HOOK, hookSelector} from "../project/editorUiHooks";
import {BITMAP_BYTES_PER_PIXEL, bitmapWidthPx, drawnPixelsIn, scaledRect} from "./capturedViews";
import type {CapturedRect} from "./capturedViews";

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
const HTTP_BAD_REQUEST = 400;
const HTTP_PUT = "PUT";
const JSON_CONTENT_TYPE = "application/json";
const ARGV_APP_ARGS_START_UNPACKAGED = 2;
const ARGV_APP_ARGS_START_PACKAGED = 1;
const AS_USER_GESTURE = true;
const WINDOW_SETTINGS_FILE = "window-settings.json";
const LEAVE_PAGE_BUTTONS = ["Leave", "Stay"];
const LEAVE_PAGE_INDEX = 0;
const STAY_ON_PAGE_INDEX = 1;
const LEAVE_PAGE_TITLE = "Unsaved changes";
const LEAVE_PAGE_MESSAGE = "This page has unsaved changes. Leave and lose them?";
const SMOKE_PROFILE_FOLDER = "jsengine-smoke-profile";
const SMOKE_PROFILE_PREFIX = "jsengine-smoke-profile-";
const SMOKE_PROJECT_PREFIX = "jsengine-smoke-project-";
const SMOKE_FLOW_BUDGET_MS = 60_000;
const SMOKE_WAIT_TIMEOUT_MS = 10_000;
const SMOKE_POLL_MS = 50;
const SMOKE_EVALUATE_TIMEOUT_MS = 15_000;
const SMOKE_REMOVE_RETRIES = 5;
const FLOW_LIST_SEPARATOR = ",";
const NO_FLOWS = "none";
const FLOW_SELECTION = "flowSelection";
const NO_DURATION_MS = 0;
const RECURSIVE_REMOVAL = {recursive: true, force: true, maxRetries: SMOKE_REMOVE_RETRIES};
const SMOKE_PASSED_EXIT_CODE = 0;
const SMOKE_FAILED_EXIT_CODE = 1;
const SMOKE_FAILURE_REPORT_DELAY_MS = 1000;

interface SmokeFailure {
    readonly rendererGone?: string;
    readonly exitCode?: number;
    readonly error?: string;
}

interface ViewportReport extends CapturedRect {
    readonly id: string;
    readonly canvas: boolean;
}

interface PageReport {
    readonly crossOriginIsolated: boolean;
    readonly canvas: boolean;
    readonly renderBackend: string | undefined;
    readonly cssWidthPx: number;
    readonly viewports: readonly ViewportReport[];
}

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
const EDITOR_VIEWPORT_SELECTOR = hookSelector(EDITOR_VIEWPORT_HOOK);
const repoRoot = flagValue("repo");
const requestedFlows = flagValue("flows");
const smokeFolderAnswers: string[] = [];
const smokeTempFolders: string[] = [];
const goneChildProcesses: Details[] = [];
let mainWindow: BrowserWindow | undefined;
let pendingSmokeFailure: SmokeFailure | undefined;

function isolatedSmokeProfile(): string {
    const fixed = join(tmpdir(), SMOKE_PROFILE_FOLDER);
    try {
        rmSync(fixed, RECURSIVE_REMOVAL);
        return fixed;
    } catch {
        return mkdtempSync(join(tmpdir(), SMOKE_PROFILE_PREFIX));
    }
}

if (smoke) {
    app.setPath("userData", isolatedSmokeProfile());
    app.on("child-process-gone", (_event, details) => goneChildProcesses.push(details));
}

const projectServer = createProjectServer({
    repoRoot,
    bun: locateBun(flagValue("bun")),
    browse: false,
    pickFolder: async () => {
        if (smoke) return smokeFolderAnswers.shift() ?? null;
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
    if (url.pathname === WINDOW_ZOOM_PATH) return await respondToWindowZoom(request);
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

function withTimeout<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} did not finish within ${timeoutMs} ms`)), timeoutMs);
        work.then(value => {
            clearTimeout(timer);
            resolve(value);
        }, error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function smokePageOf(window: BrowserWindow): SmokePage {
    const contents = window.webContents;
    return {
        evaluate: <T>(script: string) => withTimeout(contents.executeJavaScript(script) as Promise<T>, SMOKE_EVALUATE_TIMEOUT_MS, "the page script"),
        sendInput: (event: SmokeInputEvent) => contents.sendInputEvent(event),
        insertText: text => contents.insertText(text),
        zoomFactor: () => contents.getZoomFactor(),
    };
}

const smokeClock: SmokeClock = {now: () => Date.now(), sleep};

const smokeHost: SmokeHost = {
    createTempFolder: async () => {
        const folder = await mkdtemp(join(tmpdir(), SMOKE_PROJECT_PREFIX));
        smokeTempFolders.push(folder);
        return folder;
    },
    answerFolderPick: path => {
        smokeFolderAnswers.push(path);
    },
    fileExists: path => access(path).then(() => true, () => false),
    writeFile: (path, text) => writeFile(path, text),
};

function flowNames(): readonly string[] | undefined {
    if (requestedFlows === undefined) return undefined;
    return requestedFlows === NO_FLOWS ? [] : requestedFlows.split(FLOW_LIST_SEPARATOR).map(name => name.trim()).filter(name => name.length > 0);
}

async function runEditorFlows(window: BrowserWindow, pageErrors: readonly string[]): Promise<SmokeFlowResult[]> {
    let flows: SmokeFlow[];
    try {
        flows = selectFlows(editorSmokeFlows(), flowNames());
    } catch (error) {
        return [{name: FLOW_SELECTION, passed: false, durationMs: NO_DURATION_MS, reason: error instanceof Error ? error.message : String(error)}];
    }
    window.webContents.focus();
    const results = await runSmokeFlows(flows, {
        page: smokePageOf(window),
        clock: smokeClock,
        host: smokeHost,
        defaultBudgetMs: SMOKE_FLOW_BUDGET_MS,
        waitTimeoutMs: SMOKE_WAIT_TIMEOUT_MS,
        pollMs: SMOKE_POLL_MS,
        pageErrors: () => pageErrors,
        recover: recoverEditor,
    });
    await Promise.all(smokeTempFolders.splice(0).map(folder => rm(folder, RECURSIVE_REMOVAL).catch(() => undefined)));
    return results;
}

async function smokeTest(window: BrowserWindow, pageErrors: string[]): Promise<void> {
    await waitWhileEditorLoads(window);
    await sleep(SMOKE_SETTLE_MS);
    const editorState = await editorStateOf(window);
    const report = await window.webContents.executeJavaScript(`(() => {
        const sized = canvas => canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0 && canvas.style.display !== "none";
        const canvas = document.querySelector(${JSON.stringify(DISPLAY_CANVAS_SELECTOR)});
        const viewports = [...document.querySelectorAll(${JSON.stringify(EDITOR_VIEWPORT_SELECTOR)})].map(viewport => {
            const bounds = viewport.getBoundingClientRect();
            return {
                id: viewport.getAttribute(${JSON.stringify(EDITOR_VIEWPORT_HOOK)}),
                canvas: [...viewport.querySelectorAll("canvas")].some(sized),
                left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
            };
        });
        return {
            crossOriginIsolated,
            canvas: viewports.length > 0 ? viewports.every(viewport => viewport.canvas) : sized(canvas),
            renderBackend: document.documentElement.dataset.renderBackend,
            cssWidthPx: window.innerWidth,
            viewports,
        };
    })()`) as PageReport;
    const image = await window.webContents.capturePage();
    if (screenshotPath !== undefined) await writeFile(screenshotPath, image.toPNG());
    const bitmap = image.toBitmap();
    const widthPx = bitmapWidthPx(bitmap.length, image.getSize());
    const pxPerCssPx = report.cssWidthPx > 0 ? widthPx / report.cssWidthPx : 0;
    const drawnPixels = drawnPixelCount(bitmap);
    const viewportDrawnPixels = Object.fromEntries(report.viewports.map(viewport => [viewport.id, drawnPixelsIn(bitmap, widthPx, scaledRect(viewport, pxPerCssPx))]));
    const editorReady = editorState === undefined || editorState === EDITOR_READY_STATE;
    const requestedBackend = requestedRenderBackend(page);
    const backendMatches = renderBackendMatches(requestedBackend, report.renderBackend);
    const pagePassed = report.crossOriginIsolated && report.canvas && editorReady && backendMatches && drawnPixels >= MIN_DRAWN_PIXELS && pageErrors.length === 0;
    const loadErrors = [...pageErrors];
    const flows = pagePassed && editorState !== undefined ? await runEditorFlows(window, pageErrors) : [];
    const passed = pagePassed && smokeFlowsPassed(flows);
    if (pendingSmokeFailure !== undefined) return;
    const {crossOriginIsolated, canvas, renderBackend} = report;
    console.log(JSON.stringify({page, crossOriginIsolated, canvas, renderBackend, requestedBackend, editorState, drawnPixels, viewportDrawnPixels, pageErrors: loadErrors, flows, childProcessesGone: goneChildProcesses, passed}));
    app.exit(passed ? SMOKE_PASSED_EXIT_CODE : SMOKE_FAILED_EXIT_CODE);
}

function failSmoke(failure: SmokeFailure): void {
    const reportScheduled = pendingSmokeFailure !== undefined;
    pendingSmokeFailure = {...pendingSmokeFailure, ...failure};
    if (reportScheduled) return;
    setTimeout(() => {
        console.log(JSON.stringify({page, ...pendingSmokeFailure, childProcessesGone: goneChildProcesses, passed: false}));
        app.exit(SMOKE_FAILED_EXIT_CODE);
    }, SMOKE_FAILURE_REPORT_DELAY_MS);
}

function failWhenTheRendererDies(window: BrowserWindow): void {
    window.webContents.on("render-process-gone", (_event, details) => failSmoke({rendererGone: details.reason, exitCode: details.exitCode}));
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

function applyZoomFactor(window: BrowserWindow, zoomFactor: number): void {
    window.webContents.setZoomFactor(zoomFactor);
    void writeFile(windowSettingsPath(), zoomSettingsText(zoomFactor));
}

function handleZoomShortcuts(window: BrowserWindow): void {
    window.webContents.on("before-input-event", (event, input) => {
        const command = zoomCommandOf(input);
        if (command === undefined) return;
        event.preventDefault();
        applyZoomFactor(window, nextZoomFactor(window.webContents.getZoomFactor(), command));
    });
}

async function respondToWindowZoom(request: Request): Promise<Response> {
    const window = mainWindow;
    if (window === undefined) return new Response("No window to zoom", {status: HTTP_NOT_FOUND, headers: ISOLATION_HEADERS});
    if (request.method === HTTP_PUT) {
        const zoomFactor = zoomFactorOfText(await request.text());
        if (zoomFactor === undefined) return new Response(`Send {"zoomFactor": n} with n from ${ZOOM_FACTORS[0]} to ${ZOOM_FACTORS[ZOOM_FACTORS.length - 1]}`, {status: HTTP_BAD_REQUEST, headers: ISOLATION_HEADERS});
        applyZoomFactor(window, zoomFactor);
    }
    return new Response(zoomSettingsText(window.webContents.getZoomFactor()), {headers: {...ISOLATION_HEADERS, "Content-Type": JSON_CONTENT_TYPE}});
}

function confirmLeavingUnsavedPages(window: BrowserWindow): void {
    window.webContents.on("will-prevent-unload", event => {
        if (smoke) {
            event.preventDefault();
            return;
        }
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
    if (smoke) failWhenTheRendererDies(window);
    await window.loadURL(`${SCHEME}://${HOST}/${page}`);
    await pressPlay(window);
    if (smoke) await smokeTest(window, pageErrors);
}

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => projectServer.close());
void app.whenReady().then(openWindow).catch((error: unknown) => {
    if (!smoke) throw error;
    failSmoke({error: error instanceof Error ? error.message : String(error)});
});
