import type {SampleProject} from "../project/sampleProjects";
import {RECENT_PROJECT_HOOK, START_ACTION_HOOK, START_MESSAGE_ACTION_HOOK} from "../project/editorUiHooks";
import type {StartAction, StartMessageAction} from "../project/editorUiHooks";
import {button, element} from "./domElements";
import type {RecentProject} from "./recentProjects";

export interface StartScreenAction {
    readonly id: StartMessageAction;
    readonly label: string;
    readonly run: () => void;
}

export interface StartScreenOptions {
    readonly openProject: () => void;
    readonly openRecent: (project: RecentProject) => void;
    readonly forgetRecent: (project: RecentProject) => void;
    readonly openSample: (sample: SampleProject) => void;
    readonly samples: readonly SampleProject[];
    readonly modeNote: string;
}

function startActionButton(created: HTMLButtonElement, action: StartAction): HTMLButtonElement {
    created.setAttribute(START_ACTION_HOOK, action);
    return created;
}

export class StartScreen {
    private readonly root: HTMLElement;
    private readonly recentList: HTMLElement;
    private readonly message: HTMLElement;
    private readonly actions: HTMLElement;
    private readonly document: Document;

    public constructor(private readonly body: HTMLElement, private readonly options: StartScreenOptions) {
        this.document = body.ownerDocument;
        const document = this.document;
        this.root = element(document, "main", "start-screen");
        const title = element(document, "h1", "start-title", "JsEngine editor");
        this.actions = element(document, "div", "start-actions");
        this.actions.append(startActionButton(button(document, "Open project…", options.openProject, "start-button start-primary"), "open"));
        if (options.samples.length > 0) {
            const samples = element(document, "div", "start-samples");
            samples.append(element(document, "span", "start-samples-label", "Open sample:"));
            for (const sample of options.samples) samples.append(startActionButton(button(document, sample.label, () => options.openSample(sample)), "sample"));
            this.actions.append(samples);
        }
        const note = element(document, "p", "start-note", options.modeNote);
        this.message = element(document, "section", "start-message");
        this.message.hidden = true;
        const recentSection = element(document, "section", "start-recent");
        recentSection.append(element(document, "h2", undefined, "Recent projects"));
        this.recentList = element(document, "ul", "start-recent-list");
        recentSection.append(this.recentList);
        this.root.append(title, this.actions, note, this.message, recentSection);
        body.append(this.root);
    }

    public showRecent(projects: readonly RecentProject[]): void {
        const document = this.document;
        this.recentList.replaceChildren();
        if (projects.length === 0) {
            this.recentList.append(element(document, "li", "start-recent-empty", "No recent projects yet."));
            return;
        }
        for (const project of projects) {
            const item = element(document, "li", "start-recent-item");
            const open = button(document, project.name, () => this.options.openRecent(project), "start-recent-open");
            open.title = project.path;
            open.setAttribute(RECENT_PROJECT_HOOK, project.path);
            const path = element(document, "span", "start-recent-path", project.path);
            const forget = button(document, "×", () => this.options.forgetRecent(project), "start-recent-forget");
            forget.title = "Remove from the list";
            item.append(open, path, forget);
            this.recentList.append(item);
        }
    }

    public showBusy(text: string): void {
        this.disableActions();
        this.showMessage(text, [], []);
    }

    public showProblems(title: string, problems: readonly string[], actions: readonly StartScreenAction[]): void {
        this.enableActions();
        this.showMessage(title, problems, actions);
    }

    public clearMessage(): void {
        this.enableActions();
        this.message.hidden = true;
        this.message.replaceChildren();
    }

    public remove(): void {
        this.root.remove();
    }

    private disableActions(): void {
        for (const control of this.root.querySelectorAll("button")) control.disabled = true;
    }

    private enableActions(): void {
        for (const control of this.root.querySelectorAll("button")) control.disabled = false;
    }

    private showMessage(title: string, problems: readonly string[], actions: readonly StartScreenAction[]): void {
        const document = this.document;
        this.message.replaceChildren(element(document, "h2", undefined, title));
        if (problems.length > 0) {
            const list = element(document, "ul", "start-problems");
            for (const problem of problems) list.append(element(document, "li", undefined, problem));
            this.message.append(list);
        }
        if (actions.length > 0) {
            const row = element(document, "div", "start-message-actions");
            for (const action of actions) {
                const actionButton = button(document, action.label, action.run);
                actionButton.setAttribute(START_MESSAGE_ACTION_HOOK, action.id);
                row.append(actionButton);
            }
            this.message.append(row);
        }
        this.message.hidden = false;
    }
}
