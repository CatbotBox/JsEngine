import type {ProjectTarget} from "../../engine/project/projectTargets";
import {PACKAGED_TARGET} from "../project/projectServerApi";
import {BuildWindowModel, buildCommandText, chainText} from "./buildWindowModel";
import type {BuildAction, BuildWindowServices, TargetReportView} from "./buildWindowModel";
import {openModal} from "./dialogs";
import type {Modal} from "./dialogs";
import {createButton, createElement} from "./dom";
import {BUILD_ACTION_HOOK, BUILD_TARGET_HOOK, BUILD_TARGET_STATE_HOOK} from "../project/editorUiHooks";
import type {BuildTargetState, BuildWindowAction} from "../project/editorUiHooks";

export interface BuildWindowHost {
    readonly document: Document;
    readonly services: BuildWindowServices;
    readonly unavailableReason?: string;
}

interface TargetRow {
    readonly element: HTMLElement;
    readonly status: HTMLElement;
    readonly details: HTMLElement;
    readonly buildButton: HTMLButtonElement;
    readonly packageButton: HTMLButtonElement | undefined;
}

export const BUILD_WINDOW_TITLE = "Build";

const LOADING_TEXT = "Reading the project's targets…";
const NOT_BUILT_TEXT = "Not built yet";
const BUILDING_TEXT = "Building…";
const PACKAGING_TEXT = "Packaging…";
const WAITING_TEXT = "Waiting…";
const PACKAGED_TEXT = "Packaged";
const PACKAGE_FAILED_TEXT = "Packaging failed; see the console";
const OUTPUT_HINT = "Output goes to the console panel.";
const OK_CLASS = "ok";
const FAILING_CLASS = "failing";
const RUNNING_CLASS = "running";

function buildActionButton(button: HTMLButtonElement, action: BuildWindowAction): HTMLButtonElement {
    button.setAttribute(BUILD_ACTION_HOOK, action);
    return button;
}

function targetState(report: TargetReportView | undefined, running: BuildAction | undefined): BuildTargetState {
    if (running !== undefined) return "running";
    if (report === undefined) return "idle";
    return report.ok ? "ok" : "failing";
}

export class BuildWindow {
    private readonly model: BuildWindowModel;
    private readonly modal: Modal;
    private readonly notice: HTMLElement;
    private readonly list: HTMLElement;
    private readonly status: HTMLElement;
    private readonly buildAllButton: HTMLButtonElement;
    private readonly rows = new Map<ProjectTarget, TargetRow>();
    private readonly unsubscribe: () => void;
    private closed = false;

    private constructor(private readonly host: BuildWindowHost, private readonly onClosed: () => void) {
        const document = host.document;
        this.model = new BuildWindowModel(host.services);
        this.modal = openModal(document, BUILD_WINDOW_TITLE, "build", () => this.close());
        this.modal.dialog.classList.add("build-dialog");
        this.notice = createElement(document, "p", "build-notice");
        this.list = createElement(document, "div", "build-targets", LOADING_TEXT);
        this.status = createElement(document, "span", "build-status", OUTPUT_HINT);
        this.buildAllButton = buildActionButton(createButton(document, {className: "primary", text: "Build all", title: "Run jsengine build for every listed target, one after another", onClick: () => void this.model.buildAll()}), "buildAll");
        const close = buildActionButton(createButton(document, {className: "", text: "Close", title: "Close the Build window; a running build still finishes and logs to the console", onClick: () => this.close()}), "close");
        this.modal.buttons.append(this.status, this.buildAllButton, close);
        for (const element of [this.notice, this.list]) this.modal.dialog.insertBefore(element, this.modal.buttons);
        this.unsubscribe = this.model.onChange(() => this.modelChanged());
        this.showState();
        void this.model.load();
    }

    public static open(host: BuildWindowHost, onClosed: () => void): BuildWindow {
        return new BuildWindow(host, onClosed);
    }

    public focus(): void {
        this.buildAllButton.focus();
    }

    public close(): void {
        if (this.closed) return;
        this.closed = true;
        this.unsubscribe();
        this.modal.close();
        this.onClosed();
    }

    private get unavailable(): boolean {
        return this.host.unavailableReason !== undefined;
    }

    private modelChanged(): void {
        if (this.closed) return;
        if (this.model.loaded && this.rows.size === 0) this.createRows();
        this.showState();
    }

    private createRows(): void {
        const document = this.host.document;
        this.list.replaceChildren();
        for (const target of this.model.targets) {
            const element = createElement(document, "section", "build-target");
            element.setAttribute(BUILD_TARGET_HOOK, target);
            const header = createElement(document, "div", "build-target-header");
            const name = createElement(document, "span", "build-target-name", target);
            header.append(name);
            const status = createElement(document, "span", "build-target-status");
            const buildButton = buildActionButton(createButton(document, {className: "", text: "Build", title: `Run ${buildCommandText(target)} and check the features its bundles use`, onClick: () => void this.model.build(target)}), "build");
            header.append(status, buildButton);
            const packageButton = target === PACKAGED_TARGET
                ? buildActionButton(createButton(document, {className: "", text: "Package", title: `Run jsengine package --target ${PACKAGED_TARGET} to make the desktop app`, onClick: () => void this.model.packageWindow()}), "package")
                : undefined;
            if (packageButton !== undefined) header.append(packageButton);
            const details = createElement(document, "div", "build-target-details");
            element.append(header, details);
            this.list.append(element);
            this.rows.set(target, {element, status, details, buildButton, packageButton});
        }
    }

    private showState(): void {
        const model = this.model;
        const notices = [this.host.unavailableReason, model.targetsProblem].filter((text): text is string => text !== undefined);
        this.notice.textContent = notices.join(" ");
        this.notice.hidden = notices.length === 0;
        const blocked = model.busy || this.unavailable || !model.loaded;
        this.buildAllButton.disabled = blocked || model.targets.length === 0;
        for (const [target, row] of this.rows) {
            const report = model.reportOf(target);
            const running = model.running?.target === target ? model.running.action : undefined;
            row.element.classList.toggle(OK_CLASS, report?.ok === true);
            row.element.classList.toggle(FAILING_CLASS, report?.ok === false);
            row.element.classList.toggle(RUNNING_CLASS, running !== undefined);
            row.element.setAttribute(BUILD_TARGET_STATE_HOOK, targetState(report, running));
            row.status.textContent = this.statusText(target, report, running);
            row.buildButton.disabled = blocked;
            if (row.packageButton !== undefined) row.packageButton.disabled = blocked;
            row.details.replaceChildren(...(report === undefined ? [] : this.reportDetails(report)));
        }
    }

    private statusText(target: ProjectTarget, report: TargetReportView | undefined, running: BuildAction | undefined): string {
        if (running === "build") return BUILDING_TEXT;
        if (running === "package") return PACKAGING_TEXT;
        const packaged = target === PACKAGED_TARGET && this.model.packaged !== undefined ? (this.model.packaged ? PACKAGED_TEXT : PACKAGE_FAILED_TEXT) : undefined;
        const built = report?.summary ?? (this.model.busy ? WAITING_TEXT : NOT_BUILT_TEXT);
        return packaged === undefined ? built : `${built}; ${packaged}`;
    }

    private reportDetails(report: TargetReportView): HTMLElement[] {
        const document = this.host.document;
        const details: HTMLElement[] = [];
        if (report.errors.length > 0) {
            const errors = createElement(document, "ul", "build-errors");
            for (const error of report.errors) errors.append(createElement(document, "li", "", error));
            details.push(errors);
        }
        if (report.problems.length > 0) {
            const problems = createElement(document, "ul", "build-problems");
            for (const problem of report.problems) {
                const item = createElement(document, "li", "build-problem");
                const line = createElement(document, "div", "build-problem-line");
                line.append(
                    createElement(document, "span", "build-problem-feature", `lacks ${problem.feature}`),
                    createElement(document, "code", "build-problem-symbol", problem.symbol),
                    createElement(document, "span", "build-problem-location", problem.location),
                );
                const chain = createElement(document, "div", "build-problem-chain", chainText(problem.chain));
                chain.title = `Import chain in ${problem.bundle}`;
                item.append(line, chain);
                problems.append(item);
            }
            details.push(problems);
        }
        return details;
    }
}

export function openBuildWindow(host: BuildWindowHost, onClosed: () => void): BuildWindow {
    return BuildWindow.open(host, onClosed);
}
