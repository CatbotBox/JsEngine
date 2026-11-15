import type {BrowseResult} from "../project/projectServerApi";
import {button, element} from "./domElements";

export type BrowseFolders = (path: string | undefined) => Promise<BrowseResult>;

const ESCAPE_KEY = "Escape";

export function browseForFolder(body: HTMLElement, browse: BrowseFolders): Promise<string | null> {
    const document = body.ownerDocument;
    return new Promise<string | null>(resolve => {
        const overlay = element(document, "div", "folder-browser-overlay");
        const dialog = element(document, "div", "folder-browser");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-label", "Choose a project folder");
        const heading = element(document, "h2", undefined, "Choose a project folder");
        const pathLine = element(document, "div", "folder-browser-path");
        const roots = element(document, "div", "folder-browser-roots");
        const list = element(document, "ul", "folder-browser-list");
        const error = element(document, "p", "folder-browser-error");
        error.hidden = true;
        const footer = element(document, "div", "folder-browser-actions");
        let current: BrowseResult | undefined;

        const close = (path: string | null): void => {
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve(path);
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== ESCAPE_KEY) return;
            event.preventDefault();
            close(null);
        };
        const show = async (path: string | undefined): Promise<void> => {
            try {
                const result = await browse(path);
                current = result;
                error.hidden = true;
                pathLine.textContent = result.path;
                roots.replaceChildren(...result.roots.map(root => button(document, root.name, () => void show(root.path), "folder-browser-root")));
                const items: HTMLElement[] = [];
                if (result.parent !== null) {
                    const parent = result.parent;
                    const up = element(document, "li");
                    up.append(button(document, "⬑ ..", () => void show(parent), "folder-browser-entry"));
                    items.push(up);
                }
                for (const directory of result.directories) {
                    const item = element(document, "li");
                    item.append(button(document, `📁 ${directory.name}`, () => void show(directory.path), "folder-browser-entry"));
                    items.push(item);
                }
                list.replaceChildren(...items);
            } catch (failure) {
                error.textContent = failure instanceof Error ? failure.message : String(failure);
                error.hidden = false;
            }
        };

        footer.append(
            button(document, "Open this folder", () => {
                if (current !== undefined) close(current.path);
            }, "start-button start-primary"),
            button(document, "Cancel", () => close(null)),
        );
        dialog.append(heading, pathLine, roots, list, error, footer);
        overlay.append(dialog);
        body.append(overlay);
        document.addEventListener("keydown", onKey, true);
        void show(undefined);
    });
}
