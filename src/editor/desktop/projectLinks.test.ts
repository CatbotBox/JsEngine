import {afterEach, beforeEach, describe, expect, test} from "../../engine/testing/harness";
import type * as Fs from "fs";
import type * as Os from "os";
import type * as Path from "path";
import {isLinkedToCheckout} from "./projectLinks";

const fs = require("fs") as typeof Fs;
const os = require("os") as typeof Os;
const path = require("path") as typeof Path;

const ENGINE_PACKAGE = "@jsengine/engine";
const HOSTS_PACKAGE = "@jsengine/hosts";
const ENGINE_WORKSPACE = "src/engine";
const HOSTS_WORKSPACE = "src/hosts";
const DIRECTORY_LINK_TYPE = "junction";

let scratch = "";

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify(value));
}

function makeCheckout(name: string): string {
    const root = path.join(scratch, name);
    writeJson(path.join(root, "package.json"), {name: "jsengine", workspaces: [ENGINE_WORKSPACE, HOSTS_WORKSPACE]});
    writeJson(path.join(root, ENGINE_WORKSPACE, "package.json"), {name: ENGINE_PACKAGE});
    writeJson(path.join(root, HOSTS_WORKSPACE, "package.json"), {name: HOSTS_PACKAGE});
    return root;
}

function makeProject(name: string): string {
    const folder = path.join(scratch, name);
    fs.mkdirSync(folder, {recursive: true});
    return folder;
}

function linkPackage(folder: string, packageName: string, target: string): void {
    const link = path.join(folder, "node_modules", ...packageName.split("/"));
    fs.mkdirSync(path.dirname(link), {recursive: true});
    fs.symlinkSync(target, link, DIRECTORY_LINK_TYPE);
}

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jsengine-links-"));
});

afterEach(() => {
    fs.rmSync(scratch, {recursive: true, force: true});
});

describe("project links", () => {
    test("a project whose node_modules link every engine workspace of the checkout is linked", async () => {
        const checkout = makeCheckout("checkout");
        const project = makeProject("game");
        linkPackage(project, ENGINE_PACKAGE, path.join(checkout, ENGINE_WORKSPACE));
        linkPackage(project, HOSTS_PACKAGE, path.join(checkout, HOSTS_WORKSPACE));
        expect(await isLinkedToCheckout(project, checkout)).toBe(true);
    });

    test("a project missing one engine package is not linked", async () => {
        const checkout = makeCheckout("checkout");
        const project = makeProject("game");
        linkPackage(project, ENGINE_PACKAGE, path.join(checkout, ENGINE_WORKSPACE));
        expect(await isLinkedToCheckout(project, checkout)).toBe(false);
        expect(await isLinkedToCheckout(makeProject("bare"), checkout)).toBe(false);
    });

    test("a project linked to another checkout is not linked to this one", async () => {
        const checkout = makeCheckout("checkout");
        const other = makeCheckout("other");
        const project = makeProject("game");
        linkPackage(project, ENGINE_PACKAGE, path.join(other, ENGINE_WORKSPACE));
        linkPackage(project, HOSTS_PACKAGE, path.join(other, HOSTS_WORKSPACE));
        expect(await isLinkedToCheckout(project, checkout)).toBe(false);
        expect(await isLinkedToCheckout(project, other)).toBe(true);
    });

    test("packages resolve through an enclosing folder's node_modules, as they do for the projects inside the checkout", async () => {
        const checkout = makeCheckout("checkout");
        linkPackage(checkout, ENGINE_PACKAGE, path.join(checkout, ENGINE_WORKSPACE));
        linkPackage(checkout, HOSTS_PACKAGE, path.join(checkout, HOSTS_WORKSPACE));
        const nested = path.join(checkout, "demo", "game");
        fs.mkdirSync(nested, {recursive: true});
        expect(await isLinkedToCheckout(nested, checkout)).toBe(true);
    });

    test("the nearest node_modules wins, so a project's own stale link hides the enclosing checkout's", async () => {
        const checkout = makeCheckout("checkout");
        const other = makeCheckout("other");
        linkPackage(checkout, ENGINE_PACKAGE, path.join(checkout, ENGINE_WORKSPACE));
        linkPackage(checkout, HOSTS_PACKAGE, path.join(checkout, HOSTS_WORKSPACE));
        const nested = path.join(checkout, "demo", "game");
        linkPackage(nested, ENGINE_PACKAGE, path.join(other, ENGINE_WORKSPACE));
        expect(await isLinkedToCheckout(nested, checkout)).toBe(false);
    });
});
