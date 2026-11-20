import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {dirname, join, resolve} from "path";
import {describe, expect, test} from "../../engine/testing/harness";
import type {GeneratedSource, GeneratorOutput} from "./generatedHeader";
import {generateProjectSystems, SYSTEMS_GENERATED_HEADER} from "./systems";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const LINE_BREAK = "\r\n";
const INSIDE_REPO_FIXTURE_PREFIX = join(__dirname, "fixture-");
const OUTSIDE_REPO_FIXTURE_PREFIX = join(tmpdir(), "jsengine-systems-");
const ENTRY_PREFIX = "    ";
const SHARED_LIST = "generated/systems.ts";
const CELLS_LIST = "generated/systems.cells.ts";
const PIXELS_LIST = "generated/systems.pixels.ts";
const GPU_LIST = "generated/systems.gpu.ts";
const NO_EXCLUDED_NAMES: readonly string[] = [];

type FixtureFiles = Readonly<Record<string, string>>;

function generateFixture(files: FixtureFiles, folderPrefix = OUTSIDE_REPO_FIXTURE_PREFIX, exclude = NO_EXCLUDED_NAMES): GeneratorOutput {
    const projectFolder = mkdtempSync(folderPrefix);
    try {
        for (const [path, text] of Object.entries(files)) {
            const target = join(projectFolder, path);
            mkdirSync(dirname(target), {recursive: true});
            writeFileSync(target, text);
        }
        return generateProjectSystems(projectFolder, {repoRoot: REPO_ROOT, exclude});
    } finally {
        rmSync(projectFolder, {recursive: true, force: true});
    }
}

function sourceOf(output: GeneratorOutput, file: string): string {
    const generated = output.sources.find((source: GeneratedSource) => source.file === file);
    if (generated === undefined) throw new Error(`the generator wrote no ${file}`);
    return generated.source;
}

function entriesOf(output: GeneratorOutput, file: string): string[] {
    return sourceOf(output, file).split(LINE_BREAK).filter(line => line.startsWith(ENTRY_PREFIX)).map(line => line.trim().replace(/,$/, ""));
}

const DISCOVERY_FIXTURE: FixtureFiles = {
    "game.ts": `
import {System, SystemGroup} from "@jsengine/engine/core";

export class MoveSystem extends System {
}

export class CombatGroup extends SystemGroup {
}

export abstract class BaseSystem extends System {
}

export class DerivedSystem extends BaseSystem {
}

class HiddenSystem extends System {
}

export class NotASystem {
}

export class NeedsArguments extends System {
    public constructor(public readonly speed: number) {
        super();
    }
}

export class OptionalArguments extends System {
    public constructor(public readonly speed = 1) {
        super();
    }
}

export {HiddenSystem as ShownSystem};
`,
    "ai/brain.ts": `
import {System} from "@jsengine/engine/core";

export class BrainSystem extends System {
}
`,
    "defaults.ts": `
import {System} from "@jsengine/engine/core";

export default class DefaultSystem extends System {
}
`,
    "game.test.ts": `
import {System} from "@jsengine/engine/core";

export class TestSystem extends System {
}
`,
    "backend/cells/cellsControls.ts": `
import {System} from "@jsengine/engine/core";

export class CellsControlsSystem extends System {
}
`,
    "backend/gpu/shaders/shaderSystem.ts": `
import {System} from "@jsengine/engine/core";

export class ShaderSystem extends System {
}
`,
    "backend/gpu/controls.ts": `
import {System} from "@jsengine/engine/core";

export class GpuControlsSystem extends System {
}
`,
    "backend/vulkan/vulkanSystem.ts": `
import {System} from "@jsengine/engine/core";

export class VulkanSystem extends System {
}

export class OtherVulkanSystem extends System {
}
`,
    "backend/loose.ts": `
import {System} from "@jsengine/engine/core";

export class LooseSystem extends System {
}
`,
};

describe("generateProjectSystems discovery", () => {
    const discovery = () => generateFixture(DISCOVERY_FIXTURE);

    test("lists exported, non-abstract systems and groups by file path then class name, skipping tests", () => {
        expect(entriesOf(discovery(), SHARED_LIST)).toEqual([
            "BrainSystem",
            "CombatGroup",
            "DerivedSystem",
            "ShownSystem",
            "MoveSystem",
            "OptionalArguments",
        ]);
    });

    test("puts systems under backend/<kind>/ in that backend's list, nested folders included, and none in the shared list", () => {
        const output = discovery();
        expect(entriesOf(output, CELLS_LIST)).toEqual(["CellsControlsSystem"]);
        expect(entriesOf(output, PIXELS_LIST)).toEqual([]);
        expect(entriesOf(output, GPU_LIST)).toEqual(["GpuControlsSystem", "ShaderSystem"]);
    });

    test("warns about default exports, constructor arguments and systems outside the backend folders, once per place", () => {
        expect(discovery().warnings).toEqual([
            "backend/loose.ts is outside the render backend folders, so its systems are left out; put backend code in backend/cells/, backend/pixels/, backend/gpu/",
            "backend/vulkan/ is outside the render backend folders, so its systems are left out; put backend code in backend/cells/, backend/pixels/, backend/gpu/",
            "DefaultSystem: default-exported systems are skipped; export it by name (defaults.ts)",
            "NeedsArguments takes constructor arguments, so the system list cannot create it; give it a constructor without parameters (game.ts)",
        ]);
    });

    test("leaves out excluded class names and warns about an excluded name that matches no system", () => {
        const output = generateFixture(DISCOVERY_FIXTURE, OUTSIDE_REPO_FIXTURE_PREFIX, ["MoveSystem", "ShaderSystem", "Renamed"]);
        expect(entriesOf(output, SHARED_LIST).includes("MoveSystem")).toBe(false);
        expect(entriesOf(output, GPU_LIST)).toEqual(["GpuControlsSystem"]);
        expect(output.warnings.includes(`systems.exclude: "Renamed" matches no system; remove it from jsengine.project.json`)).toBe(true);
        expect(output.warnings.some(warning => warning.includes(`"MoveSystem"`) || warning.includes(`"ShaderSystem"`))).toBe(false);
    });

    test("aliases a class name that collides with another file's", () => {
        const output = generateFixture({
            "a.ts": `import {System} from "@jsengine/engine/core";\nexport class TickSystem extends System {\n}\n`,
            "b.ts": `import {System} from "@jsengine/engine/core";\nexport class TickSystem extends System {\n}\n`,
        });
        expect(sourceOf(output, SHARED_LIST).split(LINE_BREAK).slice(1, 4)).toEqual([
            `import type {System, SystemCtor} from "@jsengine/engine/core";`,
            `import {TickSystem} from "../a";`,
            `import {TickSystem as TickSystem_2} from "../b";`,
        ]);
        expect(entriesOf(output, SHARED_LIST)).toEqual(["TickSystem", "TickSystem_2"]);
    });
});

describe("generateProjectSystems output", () => {
    test("writes one list per backend beside the shared one, each starting with the header, in CRLF", () => {
        const output = generateFixture({"game.ts": `import {System} from "@jsengine/engine/core";\nexport class MoveSystem extends System {\n}\n`});
        expect(output.sources.map(source => source.file)).toEqual([SHARED_LIST, CELLS_LIST, PIXELS_LIST, GPU_LIST]);
        for (const {source} of output.sources) {
            expect(source.startsWith(SYSTEMS_GENERATED_HEADER + LINE_BREAK)).toBe(true);
            expect(source.endsWith(LINE_BREAK)).toBe(true);
            expect(source.split(LINE_BREAK).some(line => line.includes("\n") || line.includes("\r"))).toBe(false);
        }
        expect(sourceOf(output, SHARED_LIST).split(LINE_BREAK).slice(1)).toEqual([
            `import type {System, SystemCtor} from "@jsengine/engine/core";`,
            `import {MoveSystem} from "../game";`,
            "",
            "export const generatedSystems: readonly SystemCtor<System>[] = [",
            "    MoveSystem,",
            "];",
            "",
        ]);
    });

    test("writes an empty list for a backend without systems", () => {
        expect(sourceOf(generateFixture({"empty.ts": "export const NOTHING = 0;\n"}), PIXELS_LIST).split(LINE_BREAK).slice(1)).toEqual([
            `import type {System, SystemCtor} from "@jsengine/engine/core";`,
            "",
            "export const generatedPixelsSystems: readonly SystemCtor<System>[] = [];",
            "",
        ]);
    });

    test("imports the engine relatively when the project is inside the repo", () => {
        const output = generateFixture({"inside.ts": `import {System} from "../../../engine/core";\nexport class InsideSystem extends System {\n}\n`}, INSIDE_REPO_FIXTURE_PREFIX);
        expect(sourceOf(output, SHARED_LIST).split(LINE_BREAK).slice(1, 3)).toEqual([
            `import type {System, SystemCtor} from "../../../../engine/core";`,
            `import {InsideSystem} from "../inside";`,
        ]);
    });

    test("is deterministic", () => {
        expect(generateFixture(DISCOVERY_FIXTURE).sources).toEqual(generateFixture(DISCOVERY_FIXTURE).sources);
    });
});
