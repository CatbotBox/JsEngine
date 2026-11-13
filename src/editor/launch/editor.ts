import {startEditorPage} from "./editorPage";
import type {EditorPageOptions} from "./editorPage";

type EditorGame = "2d" | "3d";

interface EditorGamePage extends EditorPageOptions {
    readonly title: string;
}

const GAME_QUERY_PARAMETER = "game";
const DEFAULT_EDITOR_GAME: EditorGame = "2d";
const EDITOR_GAMES: Readonly<Record<EditorGame, EditorGamePage>> = {
    "2d": {workerUrl: "editor2d.worker.js", name: "the 2D editor", title: "JsEngine editor: 2D"},
    "3d": {workerUrl: "editor3d.worker.js", name: "the 3D editor", title: "JsEngine editor: 3D"},
};

function isEditorGame(value: string | undefined): value is EditorGame {
    return value !== undefined && Object.hasOwn(EDITOR_GAMES, value);
}

function editorGameFromQuery(search: string): EditorGame {
    const value = new URLSearchParams(search).get(GAME_QUERY_PARAMETER)?.trim();
    return isEditorGame(value) ? value : DEFAULT_EDITOR_GAME;
}

const game = EDITOR_GAMES[editorGameFromQuery(location.search)];
document.title = game.title;
startEditorPage(game);
