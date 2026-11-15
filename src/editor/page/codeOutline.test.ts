import {describe, expect, test} from "../../engine/testing/harness";
import {groupOutline, maskCommentsAndStrings, outlineCode} from "./codeOutline";
import type {OutlineSymbol} from "./codeOutline";

function summary(symbols: readonly OutlineSymbol[]): string[] {
    return symbols.map(symbol => `${symbol.kind} ${symbol.name}${symbol.typeName === undefined ? "" : ` "${symbol.typeName}"`} :${symbol.line}`);
}

describe("code outline", () => {
    test("ECS classes are grouped by base class, including generic and qualified bases", () => {
        const source = [
            `import {Component, System} from "@jsengine/engine/core";`,
            `export class Ship extends Component {}`,
            `class Mover<T extends object> extends System<T> {}`,
            `export abstract class Ui extends ecs.SystemGroup {}`,
            `export class Overlay extends PresentationSystemGroup {}`,
            `export class Score extends Resource {}`,
            `export class Helper {}`,
            `class Hidden {}`,
        ].join("\n");
        expect(summary(outlineCode(source))).toEqual([
            `component Ship "Ship" :2`,
            `system Mover :3`,
            `systemGroup Ui :4`,
            `systemGroup Overlay :5`,
            `resource Score "Score" :6`,
            `class Helper :7`,
        ]);
    });

    test("schema calls name components and resources, also for classes declared elsewhere", () => {
        const source = [
            `export class Velocity extends Component {`,
            `    public static readonly schema = componentSchema(Velocity, "Velocity2D").number("x").build();`,
            `}`,
            `export class SwarmState extends Resource {`,
            `    public static readonly schema = resourceSchema(SwarmState, 'Swarm').build();`,
            `}`,
            `registry.register(componentSchema(engine.LocalPosition, "LocalPosition").build());`,
        ].join("\n");
        expect(summary(outlineCode(source))).toEqual([
            `component Velocity "Velocity2D" :1`,
            `resource SwarmState "Swarm" :4`,
            `component LocalPosition "LocalPosition" :7`,
        ]);
    });

    test("a subclass of a component or system declared in the same file inherits its group", () => {
        const source = `class Spinner extends Component {}\nexport class FastSpinner extends Spinner {}\nclass Base extends System {}\nclass Derived extends Base {}\nexport class Odd extends Light {}`;
        expect(summary(outlineCode(source))).toEqual([
            `component Spinner "Spinner" :1`,
            `component FastSpinner "FastSpinner" :2`,
            `system Base :3`,
            `system Derived :4`,
            `class Odd :5`,
        ]);
    });

    test("exported functions and constants are listed, arrow and function initializers count as functions", () => {
        const source = [
            `export function registerProjectSchemas(registry) {}`,
            `export async function setupProject(world, host) {}`,
            `export const SPEED = 3;`,
            `export const spawn = (world: World): void => {};`,
            `export const make = async <T>(value: T) => value;`,
            `export const handler: Handler = event => event;`,
            `export const sum = (a + b);`,
            `export let counter = 0;`,
            `function internal() {}`,
            `const local = 1;`,
        ].join("\n");
        expect(summary(outlineCode(source))).toEqual([
            "function registerProjectSchemas :1",
            "function setupProject :2",
            "constant SPEED :3",
            "function spawn :4",
            "function make :5",
            "function handler :6",
            "constant sum :7",
            "constant counter :8",
        ]);
    });

    test("declarations inside comments, strings, templates and regular expressions are ignored", () => {
        const source = [
            `// export class Commented extends Component {}`,
            `/* class Blocked extends System {} */`,
            `const text = "class Quoted extends Component {}";`,
            "const template = `class Templated extends Component ${value + `class Nested extends System {}`} tail`;",
            `const pattern = /class Matched extends Component/;`,
            `const ratio = a / b; export class Real extends Component {} // c / d`,
        ].join("\n");
        expect(summary(outlineCode(source))).toEqual([`component Real "Real" :6`]);
    });

    test("masking keeps the length and line breaks and blanks only comment and string contents", () => {
        const source = `a = "x\\"y"; // note\nb = \`t\${c}u\`;`;
        const masked = maskCommentsAndStrings(source);
        expect(masked.length).toBe(source.length);
        expect(masked).toBe(`a = "    ";        \nb = \` \${c} \`;`);
    });

    test("groups come in a fixed order and empty groups are left out", () => {
        const groups = groupOutline(outlineCode(`export function f() {}\nexport class C extends Component {}`));
        expect(groups.map(group => `${group.title}: ${group.symbols.map(symbol => symbol.name).join(", ")}`)).toEqual(["Components: C", "Functions: f"]);
    });
});
