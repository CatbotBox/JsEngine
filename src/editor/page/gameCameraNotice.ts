import {createElement} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";

export const NO_GAME_CAMERA_TEXT = "No camera in scene";
export const NO_GAME_CAMERA_HINT = "Add an entity with a Camera component to see the game here";

export class GameCameraNotice {
    public readonly element: HTMLElement;

    public constructor(document: Document, private readonly workspace: EditorWorkspace) {
        this.element = createElement(document, "div", "game-camera-notice");
        this.element.setAttribute("role", "status");
        this.element.append(
            createElement(document, "div", "game-camera-notice-title", NO_GAME_CAMERA_TEXT),
            createElement(document, "div", "game-camera-notice-hint", NO_GAME_CAMERA_HINT),
        );
        this.element.hidden = true;
        workspace.on("gameCamera", () => this.update());
        workspace.on("state", () => this.update());
        this.update();
    }

    public update(): void {
        this.element.hidden = !this.workspace.gameCameraMissing || this.workspace.closed;
    }
}
