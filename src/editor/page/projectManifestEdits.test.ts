import {describe, expect, test} from "../../engine/testing/harness";
import {validateProjectManifest} from "../../engine/project/projectManifest";
import {
    checkManifestDraft,
    isManifestDraftDirty,
    manifestProblemArea,
    manifestStartScene,
    manifestTextWithDraft,
    manifestWithResource,
    manifestWithStartScene,
    openManifestDraft,
} from "./projectManifestEdits";
import type {ManifestDraft, TargetDraft} from "./projectManifestEdits";

const MAIN = "scenes/main.scene.json";
const LEVEL = "scenes/level.scene.json";
const CRLF_MANIFEST = "{\r\n  \"name\": \"Swarm\",\r\n  \"startScene\": \"scenes/main.scene.json\",\r\n  \"resources\": [\r\n    {\r\n      \"type\": \"InputMap\",\r\n      \"path\": \"assets/input.asset.json\"\r\n    }\r\n  ]\r\n}\r\n";
const BARE_MANIFEST = "{\n    \"name\": \"Starter\",\n    \"entry\": \"project.ts\"\n}";
const TUNED_MANIFEST = [
    "{",
    "\t\"name\": \"Tuned\",",
    "\t\"editorExtensions\": \"editor/extensions.ts\",",
    "\t\"schemas\": {",
    "\t\t\"exclude\": [",
    "\t\t\t\"DebugTag\"",
    "\t\t],",
    "\t\t\"note\": \"kept by hand\"",
    "\t},",
    "\t\"targets\": {",
    "\t\t\"web\": {",
    "\t\t\t\"backend\": \"gpu\",",
    "\t\t\t\"pixelScale\": 2",
    "\t\t},",
    "\t\t\"terminal\": {}",
    "\t},",
    "\t\"custom\": [1, 2]",
    "}",
].join("\n");
const UNSET: TargetDraft = {declared: true, backend: "", pixelScale: ""};

function draftOf(text: string): ManifestDraft {
    const opened = openManifestDraft(text);
    if (!opened.ok) throw new Error(opened.problems.join("; "));
    return opened.draft;
}

function edited(text: string, change: (draft: ManifestDraft) => ManifestDraft): string {
    return manifestTextWithDraft(text, change(draftOf(text)));
}

function parsed(text: string): {[key: string]: unknown} {
    return JSON.parse(text) as {[key: string]: unknown};
}

describe("project manifest start scene edits", () => {
    test("setting the start scene keeps every other key, the key order, the indent and the line ends", () => {
        const edit = manifestWithStartScene(CRLF_MANIFEST, LEVEL);
        expect(edit.ok).toBe(true);
        if (!edit.ok) return;
        expect(edit.text).toBe(CRLF_MANIFEST.replace(MAIN, LEVEL));
        expect(manifestStartScene(edit.text)).toBe(LEVEL);
    });

    test("a manifest without a start scene gains one at the end and stays valid", () => {
        const edit = manifestWithStartScene(BARE_MANIFEST, `./${MAIN}`);
        expect(edit.ok).toBe(true);
        if (!edit.ok) return;
        expect(edit.text).toBe("{\n    \"name\": \"Starter\",\n    \"entry\": \"project.ts\",\n    \"startScene\": \"scenes/main.scene.json\"\n}");
        expect(validateProjectManifest(edit.text).ok).toBe(true);
    });

    test("clearing the start scene removes the key", () => {
        const edit = manifestWithStartScene(CRLF_MANIFEST, null);
        expect(edit.ok && manifestStartScene(edit.text) === null && !edit.text.includes("startScene")).toBe(true);
    });

    test("an invalid manifest or start scene is refused with the validator's problems", () => {
        const broken = manifestWithStartScene("{\"name\": 3}", MAIN);
        expect(broken.ok).toBe(false);
        if (!broken.ok) expect(broken.problems.length > 0).toBe(true);
        const notScene = manifestWithStartScene(BARE_MANIFEST, "prefabs/enemy.prefab.json");
        expect(notScene.ok).toBe(false);
        const outside = manifestWithStartScene(BARE_MANIFEST, "../elsewhere.scene.json");
        expect(outside.ok).toBe(false);
    });

    test("the start scene of a manifest that does not validate reads as none", () => {
        expect(manifestStartScene("not json")).toBe(null);
        expect(manifestStartScene(CRLF_MANIFEST)).toBe(MAIN);
    });
});

describe("project manifest drafts", () => {
    test("an untouched draft writes the file back byte for byte and is not dirty", () => {
        for (const text of [CRLF_MANIFEST, BARE_MANIFEST, TUNED_MANIFEST]) {
            const draft = draftOf(text);
            expect(manifestTextWithDraft(text, draft)).toBe(text);
            expect(isManifestDraftDirty(text, draft)).toBe(false);
        }
    });

    test("a draft reads every field the window edits, targets included", () => {
        const draft = draftOf(TUNED_MANIFEST);
        expect(draft.name).toBe("Tuned");
        expect(draft.entry).toBe(null);
        expect(draft.startScene).toBe("");
        expect(draft.schemasExclude).toEqual(["DebugTag"]);
        expect(draft.targets).toEqual({
            web: {declared: true, backend: "gpu", pixelScale: "2"},
            window: {declared: false, backend: "", pixelScale: ""},
            terminal: {declared: true, backend: "", pixelScale: ""},
        });
        expect(draftOf(CRLF_MANIFEST).targets).toEqual({web: UNSET, window: UNSET, terminal: UNSET});
    });

    test("renaming keeps the key order, the indent, the line ends and every key the window does not edit", () => {
        const renamed = edited(CRLF_MANIFEST, draft => ({...draft, name: "  Swarm Deluxe "}));
        expect(renamed).toBe(CRLF_MANIFEST.replace("\"Swarm\"", "\"Swarm Deluxe\""));
        const tuned = edited(TUNED_MANIFEST, draft => ({...draft, name: "Retuned"}));
        expect(tuned.split("\n")[1]).toBe("\t\"name\": \"Retuned\",");
        expect(Object.keys(parsed(tuned))).toEqual(["name", "editorExtensions", "schemas", "targets", "custom"]);
        expect(parsed(tuned).custom).toEqual([1, 2]);
        expect(tuned.includes("\r\n")).toBe(false);
    });

    test("the entry switches between the generated bootstrap and an own module", () => {
        const own = edited(CRLF_MANIFEST, draft => ({...draft, entry: "src/main.ts"}));
        expect(Object.keys(parsed(own))).toEqual(["name", "startScene", "resources", "entry"]);
        expect(parsed(own).entry).toBe("src/main.ts");
        const generated = edited(BARE_MANIFEST, draft => ({...draft, entry: null}));
        expect(generated).toBe("{\n    \"name\": \"Starter\"\n}");
    });

    test("targets are written only when they say more than the default, in target order", () => {
        const withoutTerminal = edited(CRLF_MANIFEST, draft => ({...draft, targets: {...draft.targets, terminal: {...UNSET, declared: false}}}));
        expect(parsed(withoutTerminal).targets).toEqual({web: {}, window: {}});
        const webGpu = edited(CRLF_MANIFEST, draft => ({...draft, targets: {...draft.targets, web: {declared: true, backend: "gpu", pixelScale: " 3 "}}}));
        expect(parsed(webGpu).targets).toEqual({web: {backend: "gpu", pixelScale: 3}, window: {}, terminal: {}});
        const everyTargetPlain = edited(TUNED_MANIFEST, draft => ({...draft, targets: {web: UNSET, window: UNSET, terminal: UNSET}}));
        expect(Object.keys(parsed(everyTargetPlain)).includes("targets")).toBe(false);
    });

    test("exclude and keep lists are trimmed, drop blank rows, and disappear when emptied while other keys stay", () => {
        const listed = edited(CRLF_MANIFEST, draft => ({...draft, systemsExclude: [" DebugSystem ", ""], keep: ["Enemy", "  "]}));
        expect(parsed(listed).systems).toEqual({exclude: ["DebugSystem"]});
        expect(parsed(listed).keep).toEqual(["Enemy"]);
        const cleared = edited(TUNED_MANIFEST, draft => ({...draft, schemasExclude: []}));
        expect(parsed(cleared).schemas).toEqual({note: "kept by hand"});
        const blankRow = draftOf(CRLF_MANIFEST);
        expect(isManifestDraftDirty(CRLF_MANIFEST, {...blankRow, keep: [""]})).toBe(false);
    });

    test("a field written in another form keeps that form until it is edited", () => {
        const text = "{\"name\": \"Game\", \"entry\": \"./src/game.ts\", \"keep\": [\"A\"]}";
        const renamed = edited(text, draft => ({...draft, name: "Other"}));
        expect(parsed(renamed).entry).toBe("./src/game.ts");
    });

    test("problems come back by the field they name, and a valid draft has none", () => {
        const draft = draftOf(CRLF_MANIFEST);
        const check = checkManifestDraft(CRLF_MANIFEST, {
            ...draft,
            name: " ",
            entry: "src/missing.ts",
            startScene: "scenes/level.json",
            targets: {...draft.targets, web: {declared: true, backend: "gpu", pixelScale: "big"}, terminal: {declared: true, backend: "pixels", pixelScale: ""}},
            keep: ["Enemy"],
        }, path => path === "src/game.ts");
        expect(check.valid).toBe(false);
        expect([...check.problems.keys()].sort()).toEqual(["entry", "name", "startScene", "targets.terminal", "targets.web"]);
        expect(check.problems.get("targets.web")?.[0].startsWith(`"targets.web.pixelScale" must be a whole number`)).toBe(true);
        const valid = checkManifestDraft(CRLF_MANIFEST, draft);
        expect(valid.valid && valid.problems.size === 0 && valid.text === CRLF_MANIFEST).toBe(true);
    });

    test("a draft with no target names that problem under targets", () => {
        const draft = draftOf(CRLF_MANIFEST);
        const none: TargetDraft = {...UNSET, declared: false};
        const check = checkManifestDraft(CRLF_MANIFEST, {...draft, targets: {web: none, window: none, terminal: none}});
        expect(check.problems.get("targets")?.[0].startsWith(`"targets" lists no target`)).toBe(true);
    });

    test("problem areas follow the quoted key a problem starts with", () => {
        expect(manifestProblemArea(`"schemas.exclude[0]" must be a non-empty type name, got ""`)).toBe("schemasExclude");
        expect(manifestProblemArea(`"keep[1]" must be a non-empty type name, got 3`)).toBe("keep");
        expect(manifestProblemArea(`"targets.mobile" is not a target; the targets are web, window, terminal`)).toBe("targets");
        expect(manifestProblemArea(`"resources[0].type" must name a registered resource type`)).toBe("general");
        expect(manifestProblemArea("jsengine.project.json is not valid JSON: Unexpected token")).toBe("general");
    });

    test("only a JSON object opens as a draft", () => {
        expect(openManifestDraft("not json").ok).toBe(false);
        expect(openManifestDraft("[1]").ok).toBe(false);
        expect(openManifestDraft("{\"name\": 3}").ok).toBe(true);
    });

    test("a resource binding is appended with its path normalised", () => {
        const edit = manifestWithResource(BARE_MANIFEST, {type: "InputMap", path: "./assets/input.asset.json"});
        expect(edit.ok).toBe(true);
        if (!edit.ok) return;
        expect(parsed(edit.text).resources).toEqual([{type: "InputMap", path: "assets/input.asset.json"}]);
        const second = manifestWithResource(CRLF_MANIFEST, {type: "Tuning", path: "assets/tuning.asset.json"});
        expect(second.ok && (parsed(second.text).resources as unknown[]).length === 2).toBe(true);
    });
});
