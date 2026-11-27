import {describe, expect, test} from "../../testing/harness";
import {DEFAULT_FLEX_CONTAINER, DEFAULT_FLEX_SIZE, FlexLayout} from "./flexLayout";
import type {FlexLayoutTree} from "./flexLayout";
import type {FlexBoxStyle, FlexContainerStyle, FlexOffsetStyle, FlexScrollStyle, FlexSizeStyle, FlexTextContent, UiBorderStyle, UiTextWrap} from "./flexStyle";

const SCREEN_WIDTH = 80;
const SCREEN_HEIGHT = 24;

interface NodeSpec {
    readonly name: string;
    readonly container?: Partial<FlexContainerStyle>;
    readonly size?: Partial<FlexSizeStyle>;
    readonly offset?: Partial<FlexOffsetStyle>;
    readonly text?: string;
    readonly wrap?: UiTextWrap;
    readonly scroll?: Partial<FlexScrollStyle>;
    readonly border?: UiBorderStyle;
    readonly children?: readonly NodeSpec[];
}

interface LaidOutRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface LaidOutClip {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

interface LaidOutScrollbar {
    readonly x: number;
    readonly y: number;
    readonly length: number;
    readonly thumbStart: number;
    readonly thumbLength: number;
}

interface LaidOutTree {
    rect(name: string): LaidOutRect;
    clip(name: string): LaidOutClip;
    scroll(name: string): {readonly x: number, readonly y: number, readonly contentWidth: number, readonly contentHeight: number};
    verticalScrollbar(name: string): LaidOutScrollbar;
    horizontalScrollbar(name: string): LaidOutScrollbar;
}

const NO_OFFSET: FlexOffsetStyle = {x: 0, y: 0, anchorX: 0, anchorY: 0};
const NO_SCROLL: FlexScrollStyle = {scrollX: 0, scrollY: 0, axes: "vertical", scrollbar: "never"};
const HIDDEN_SCROLLBAR: LaidOutScrollbar = {x: 0, y: 0, length: 0, thumbStart: 0, thumbLength: 0};

function treeOf(root: NodeSpec): {tree: FlexLayoutTree, indexOf: Map<string, number>} {
    const indexOf = new Map<string, number>();
    const subtreeEnd: number[] = [];
    const containers: (FlexContainerStyle | undefined)[] = [];
    const sizes: (FlexSizeStyle | undefined)[] = [];
    const offsets: (FlexOffsetStyle | undefined)[] = [];
    const texts: (FlexTextContent | undefined)[] = [];
    const scrolls: (FlexScrollStyle | undefined)[] = [];
    const boxes: (FlexBoxStyle | undefined)[] = [];
    const visit = (spec: NodeSpec): void => {
        const index = subtreeEnd.length;
        indexOf.set(spec.name, index);
        subtreeEnd.push(index + 1);
        containers.push(spec.container === undefined ? undefined : {...DEFAULT_FLEX_CONTAINER, ...spec.container});
        sizes.push(spec.size === undefined ? undefined : {...DEFAULT_FLEX_SIZE, ...spec.size});
        offsets.push(spec.offset === undefined ? undefined : {...NO_OFFSET, ...spec.offset});
        texts.push(spec.text === undefined ? undefined : {text: spec.text, wrap: spec.wrap ?? "none"});
        scrolls.push(spec.scroll === undefined ? undefined : {...NO_SCROLL, ...spec.scroll});
        boxes.push(spec.border === undefined ? undefined : {border: spec.border});
        for (const child of spec.children ?? []) visit(child);
        subtreeEnd[index] = subtreeEnd.length;
    };
    visit(root);
    return {tree: {count: subtreeEnd.length, subtreeEnd: Int32Array.from(subtreeEnd), containers, sizes, offsets, texts, scrolls, boxes}, indexOf};
}

function layOut(root: NodeSpec, width: number = SCREEN_WIDTH, height: number = SCREEN_HEIGHT): LaidOutTree {
    const {tree, indexOf} = treeOf(root);
    const layout = new FlexLayout();
    layout.layout(tree, 0, width, height);
    const nodeOf = (name: string): number => {
        const index = indexOf.get(name);
        if (index === undefined) throw new Error(`no node named ${name}`);
        return index;
    };
    return {
        rect: name => {
            const node = nodeOf(name);
            return {x: layout.x[node], y: layout.y[node], width: layout.width[node], height: layout.height[node]};
        },
        clip: name => {
            const node = nodeOf(name);
            return {left: layout.clipLeft[node], top: layout.clipTop[node], right: layout.clipRight[node], bottom: layout.clipBottom[node]};
        },
        scroll: name => {
            const node = nodeOf(name);
            return {x: layout.scrollX[node], y: layout.scrollY[node], contentWidth: layout.contentWidth[node], contentHeight: layout.contentHeight[node]};
        },
        verticalScrollbar: name => {
            const node = nodeOf(name), bars = layout.scrollbars;
            return {
                x: bars.verticalTrackX[node],
                y: bars.verticalTrackY[node],
                length: bars.verticalTrackLength[node],
                thumbStart: bars.verticalThumbStart[node],
                thumbLength: bars.verticalThumbLength[node],
            };
        },
        horizontalScrollbar: name => {
            const node = nodeOf(name), bars = layout.scrollbars;
            return {
                x: bars.horizontalTrackX[node],
                y: bars.horizontalTrackY[node],
                length: bars.horizontalTrackLength[node],
                thumbStart: bars.horizontalThumbStart[node],
                thumbLength: bars.horizontalThumbLength[node],
            };
        },
    };
}

function fixed(width: number, height: number): Partial<FlexSizeStyle> {
    return {widthMode: "fixed", heightMode: "fixed", width, height};
}

function box(name: string, width: number, height: number): NodeSpec {
    return {name, size: fixed(width, height)};
}

function textRows(count: number): NodeSpec[] {
    const rows: NodeSpec[] = [];
    for (let i = 0; i < count; i++) rows.push({name: `row${i}`, text: `item ${i}`});
    return rows;
}

function scrollList(scroll: Partial<FlexScrollStyle>, children: readonly NodeSpec[], size: Partial<FlexSizeStyle> = fixed(10, 4)): LaidOutTree {
    return layOut({name: "root", container: {align: "start"}, children: [{name: "list", size, scroll, children}]}, 20, 20);
}

describe("flex layout", () => {
    test("the root covers the size it is given and is its own clip", () => {
        const laidOut = layOut({name: "root"});
        expect(laidOut.rect("root")).toEqual({x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT});
        expect(laidOut.clip("root")).toEqual({left: 0, top: 0, right: SCREEN_WIDTH, bottom: SCREEN_HEIGHT});
    });

    test("a column stacks children top to bottom and stretches them across by default", () => {
        const laidOut = layOut({name: "root", children: [{name: "a", text: "abc"}, {name: "b", text: "x\ny"}, {name: "c", text: "z"}]});
        expect(laidOut.rect("a")).toEqual({x: 0, y: 0, width: SCREEN_WIDTH, height: 1});
        expect(laidOut.rect("b")).toEqual({x: 0, y: 1, width: SCREEN_WIDTH, height: 2});
        expect(laidOut.rect("c")).toEqual({x: 0, y: 3, width: SCREEN_WIDTH, height: 1});
    });

    test("a row stacks children left to right with padding and gaps", () => {
        const laidOut = layOut({
            name: "root",
            container: {direction: "row", paddingLeft: 2, paddingTop: 1, paddingRight: 3, paddingBottom: 4, gap: 1, align: "start"},
            children: [box("a", 5, 2), box("b", 3, 4), box("c", 1, 1)],
        });
        expect(laidOut.rect("a")).toEqual({x: 2, y: 1, width: 5, height: 2});
        expect(laidOut.rect("b")).toEqual({x: 8, y: 1, width: 3, height: 4});
        expect(laidOut.rect("c")).toEqual({x: 12, y: 1, width: 1, height: 1});
    });

    test("a fit container measures padding plus its children and gaps along the main axis and the largest child across", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [{
                name: "panel",
                container: {direction: "row", gap: 2, paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 2},
                children: [box("a", 4, 1), box("b", 6, 3)],
            }],
        });
        expect(laidOut.rect("panel")).toEqual({x: 0, y: 0, width: 1 + 4 + 2 + 6 + 1, height: 1 + 3 + 2});
    });

    test("text measures its longest line by its line count, and min/max clamp the measure", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [
                {name: "text", text: "ab\nabcdef\nabc"},
                {name: "clamped", text: "abcdefghij", size: {minHeight: 3, maxWidth: 4}},
            ],
        });
        expect(laidOut.rect("text")).toEqual({x: 0, y: 0, width: 6, height: 3});
        expect(laidOut.rect("clamped")).toEqual({x: 0, y: 3, width: 4, height: 3});
    });

    test("fixed sizes override the measure", () => {
        const laidOut = layOut({name: "root", container: {align: "start"}, children: [{name: "a", text: "abcdef", size: fixed(2, 5)}]});
        expect(laidOut.rect("a")).toEqual({x: 0, y: 0, width: 2, height: 5});
    });

    test("fill children share what fixed and fit children leave by weight", () => {
        const laidOut = layOut({
            name: "root",
            container: {direction: "row", gap: 1},
            children: [
                box("fixed", 10, 1),
                {name: "fit", text: "abcd"},
                {name: "one", size: {widthMode: "fill", width: 1}},
                {name: "three", size: {widthMode: "fill", width: 3}},
            ],
        }, 100, 10);
        const remainder = 100 - 10 - 4 - 3;
        expect(laidOut.rect("fixed").x).toBe(0);
        expect(laidOut.rect("fit")).toEqual({x: 11, y: 0, width: 4, height: 10});
        expect(laidOut.rect("one")).toEqual({x: 16, y: 0, width: remainder / 4, height: 10});
        expect(laidOut.rect("three")).toEqual({x: 16 + remainder / 4 + 1, y: 0, width: remainder * 3 / 4, height: 10});
    });

    test("a fill child clamped by its max is frozen and the others re-share the rest", () => {
        const laidOut = layOut({
            name: "root",
            children: [
                {name: "capped", size: {heightMode: "fill", height: 1, maxHeight: 2}},
                {name: "free", size: {heightMode: "fill", height: 1}},
            ],
        }, 10, 20);
        expect(laidOut.rect("capped").height).toBe(2);
        expect(laidOut.rect("free")).toEqual({x: 0, y: 2, width: 10, height: 18});
    });

    test("a fill child clamped by its min is frozen and the others re-share the rest", () => {
        const laidOut = layOut({
            name: "root",
            container: {direction: "row"},
            children: [
                {name: "floored", size: {widthMode: "fill", width: 1, minWidth: 20}},
                {name: "a", size: {widthMode: "fill", width: 1}},
                {name: "b", size: {widthMode: "fill", width: 1}},
            ],
        }, 30, 1);
        expect(laidOut.rect("floored").width).toBe(20);
        expect(laidOut.rect("a")).toEqual({x: 20, y: 0, width: 5, height: 1});
        expect(laidOut.rect("b")).toEqual({x: 25, y: 0, width: 5, height: 1});
    });

    test("freezing repeats until no fill child violates its limits", () => {
        const laidOut = layOut({
            name: "root",
            container: {direction: "row"},
            children: [
                {name: "a", size: {widthMode: "fill", width: 1, maxWidth: 10}},
                {name: "b", size: {widthMode: "fill", width: 1, maxWidth: 35}},
                {name: "c", size: {widthMode: "fill", width: 1}},
            ],
        }, 90, 1);
        expect([laidOut.rect("a").width, laidOut.rect("b").width, laidOut.rect("c").width]).toEqual([10, 35, 45]);
    });

    test("when children overflow, fixed and fit children keep their size and fill children get their minimum", () => {
        const laidOut = layOut({
            name: "root",
            container: {direction: "row"},
            children: [
                box("big", 8, 1),
                {name: "fill", size: {widthMode: "fill", width: 1, minWidth: 1}},
                {name: "text", text: "abcd"},
            ],
        }, 10, 1);
        expect(laidOut.rect("big")).toEqual({x: 0, y: 0, width: 8, height: 1});
        expect(laidOut.rect("fill")).toEqual({x: 8, y: 0, width: 1, height: 1});
        expect(laidOut.rect("text")).toEqual({x: 9, y: 0, width: 4, height: 1});
    });

    test("justify places leftover space at the start, centre or end, or between children", () => {
        const children = [box("a", 2, 1), box("b", 4, 1)];
        const xsOf = (justify: FlexContainerStyle["justify"]): number[] => {
            const laidOut = layOut({name: "root", container: {direction: "row", justify, gap: 1}, children}, 20, 1);
            return [laidOut.rect("a").x, laidOut.rect("b").x];
        };
        expect(xsOf("start")).toEqual([0, 3]);
        expect(xsOf("center")).toEqual([6.5, 9.5]);
        expect(xsOf("end")).toEqual([13, 16]);
        expect(xsOf("spaceBetween")).toEqual([0, 16]);
    });

    test("justify spaceBetween with one child places it at the start, and a fill child takes the leftover instead", () => {
        const single = layOut({name: "root", container: {direction: "row", justify: "spaceBetween"}, children: [box("a", 2, 1)]}, 20, 1);
        expect(single.rect("a").x).toBe(0);
        const filled = layOut({
            name: "root",
            container: {direction: "row", justify: "end"},
            children: [box("a", 2, 1), {name: "fill", size: {widthMode: "fill"}}],
        }, 20, 1);
        expect(filled.rect("a").x).toBe(0);
        expect(filled.rect("fill")).toEqual({x: 2, y: 0, width: 18, height: 1});
    });

    test("align places fit children across the main axis, stretch fills it, and fixed children keep their size under stretch", () => {
        const rectOf = (align: FlexContainerStyle["align"], child: NodeSpec): LaidOutRect =>
            layOut({name: "root", container: {align, paddingLeft: 1, paddingRight: 1}, children: [child]}, 12, 10).rect(child.name);
        const text: NodeSpec = {name: "text", text: "abcd"};
        expect(rectOf("start", text)).toEqual({x: 1, y: 0, width: 4, height: 1});
        expect(rectOf("center", text)).toEqual({x: 4, y: 0, width: 4, height: 1});
        expect(rectOf("end", text)).toEqual({x: 7, y: 0, width: 4, height: 1});
        expect(rectOf("stretch", text)).toEqual({x: 1, y: 0, width: 10, height: 1});
        expect(rectOf("stretch", box("fixed", 3, 1))).toEqual({x: 1, y: 0, width: 3, height: 1});
        expect(rectOf("stretch", {name: "capped", text: "ab", size: {maxWidth: 6}})).toEqual({x: 1, y: 0, width: 6, height: 1});
    });

    test("a fill child across the main axis takes the inner size whatever the align", () => {
        const laidOut = layOut({
            name: "root",
            container: {direction: "row", align: "center", paddingTop: 2, paddingBottom: 1},
            children: [{name: "fill", size: {heightMode: "fill"}}, box("small", 1, 1)],
        }, 10, 10);
        expect(laidOut.rect("fill")).toEqual({x: 0, y: 2, width: 0, height: 7});
        expect(laidOut.rect("small")).toEqual({x: 0, y: 5, width: 1, height: 1});
    });

    test("offset children skip the stack and sit at their anchor inside the parent's content box", () => {
        const laidOut = layOut({
            name: "root",
            container: {paddingLeft: 2, paddingTop: 1, paddingRight: 2, paddingBottom: 1},
            children: [
                box("first", 4, 2),
                {name: "badge", size: fixed(3, 1), offset: {anchorX: 1, anchorY: 0, x: -1, y: 1}},
                {name: "centred", text: "ab", offset: {anchorX: 0.5, anchorY: 0.5}},
                box("second", 4, 2),
            ],
        }, 20, 10);
        expect(laidOut.rect("first")).toEqual({x: 2, y: 1, width: 4, height: 2});
        expect(laidOut.rect("second")).toEqual({x: 2, y: 3, width: 4, height: 2});
        expect(laidOut.rect("badge")).toEqual({x: 2 + (16 - 3) - 1, y: 1 + 1, width: 3, height: 1});
        expect(laidOut.rect("centred")).toEqual({x: 2 + 7, y: 1 + 3.5, width: 2, height: 1});
    });

    test("offset children do not count toward their parent's fit size", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [{name: "panel", children: [box("a", 3, 2), {name: "overlay", size: fixed(30, 30), offset: {}}]}],
        });
        expect(laidOut.rect("panel")).toEqual({x: 0, y: 0, width: 3, height: 2});
    });

    test("word-wrapped text re-measures its height at its laid-out width and its siblings move down once", () => {
        const laidOut = layOut({
            name: "root",
            container: {paddingLeft: 1, paddingRight: 1},
            children: [
                {name: "text", text: "aaaa bbbb cccc dd", wrap: "word"},
                box("after", 2, 1),
            ],
        }, 12, 20);
        expect(laidOut.rect("text")).toEqual({x: 1, y: 0, width: 10, height: 2});
        expect(laidOut.rect("after").y).toBe(2);
    });

    test("word wrap respects the text node's own padding and a fill width in a row", () => {
        const laidOut = layOut({
            name: "root",
            container: {direction: "row", align: "start"},
            children: [
                box("left", 5, 1),
                {name: "text", text: "one two three", wrap: "word", size: {widthMode: "fill"}, container: {paddingLeft: 1, paddingRight: 1, paddingTop: 1}},
            ],
        }, 12, 20);
        expect(laidOut.rect("text")).toEqual({x: 5, y: 0, width: 7, height: 1 + 3});
    });

    test("text without word wrap keeps its unwrapped height when squeezed", () => {
        const laidOut = layOut({name: "root", children: [{name: "text", text: "aaaa bbbb cccc"}]}, 5, 20);
        expect(laidOut.rect("text")).toEqual({x: 0, y: 0, width: 5, height: 1});
    });

    test("a scroll node lays its children out unbounded on its axis, records the content size, clamps the offset and shifts the children", () => {
        const rows: NodeSpec[] = [];
        for (let i = 0; i < 10; i++) rows.push({name: `row${i}`, text: `item ${i}`});
        const scrolled = (scrollY: number) => layOut({
            name: "root",
            container: {align: "start"},
            children: [{name: "list", size: fixed(10, 4), container: {paddingTop: 1, paddingBottom: 1}, scroll: {scrollY, scrollX: 3}, children: rows}],
        }, 20, 20);

        const top = scrolled(0);
        expect(top.scroll("list")).toEqual({x: 0, y: 0, contentWidth: 10, contentHeight: 12});
        expect(top.rect("row0")).toEqual({x: 0, y: 1, width: 10, height: 1});
        expect(top.rect("row9")).toEqual({x: 0, y: 10, width: 10, height: 1});

        const middle = scrolled(3);
        expect(middle.scroll("list").y).toBe(3);
        expect(middle.rect("row0").y).toBe(-2);
        expect(middle.rect("row3").y).toBe(1);

        const past = scrolled(50);
        expect(past.scroll("list").y).toBe(12 - 4);
        expect(past.rect("row9").y).toBe(10 - 8);

        expect(scrolled(-5).scroll("list").y).toBe(0);
    });

    test("a scroll node's grandchildren move with their scrolled parent", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [{
                name: "list",
                size: fixed(10, 3),
                scroll: {scrollY: 2},
                children: [box("a", 1, 2), {name: "group", children: [box("inner", 1, 3)]}],
            }],
        }, 20, 20);
        expect(laidOut.rect("group").y).toBe(0);
        expect(laidOut.rect("inner").y).toBe(0);
        expect(laidOut.scroll("list").contentHeight).toBe(5);
    });

    test("fill children inside a scroll node grow to the viewport when the content is smaller", () => {
        const laidOut = layOut({
            name: "root",
            children: [{name: "list", size: {heightMode: "fixed", height: 6}, scroll: {}, children: [box("a", 1, 2), {name: "fill", size: {heightMode: "fill"}}]}],
        }, 10, 20);
        expect(laidOut.rect("fill")).toEqual({x: 0, y: 2, width: 10, height: 4});
        expect(laidOut.scroll("list")).toEqual({x: 0, y: 0, contentWidth: 10, contentHeight: 6});
    });

    test("a horizontal scroll node scrolls along x and clamps y to zero", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [{
                name: "strip",
                size: fixed(5, 1),
                container: {direction: "row"},
                scroll: {axes: "horizontal", scrollX: 4, scrollY: 9},
                children: [{name: "wide", text: "abcdefghijkl"}],
            }],
        }, 20, 20);
        expect(laidOut.scroll("strip")).toEqual({x: 4, y: 0, contentWidth: 12, contentHeight: 1});
        expect(laidOut.rect("wide")).toEqual({x: -4, y: 0, width: 12, height: 1});
    });

    test("clip rects intersect every clipping ancestor, and non-clipping containers pass theirs on", () => {
        const laidOut = layOut({
            name: "root",
            container: {paddingLeft: 10, paddingTop: 5, align: "start"},
            children: [{
                name: "outer",
                size: fixed(30, 10),
                container: {clip: true, paddingLeft: 20, paddingTop: 2},
                children: [{
                    name: "plain",
                    container: {align: "start"},
                    children: [{
                        name: "inner",
                        size: fixed(40, 20),
                        scroll: {axes: "both"},
                        children: [box("leaf", 1, 1)],
                    }],
                }],
            }],
        }, 100, 50);
        expect(laidOut.clip("outer")).toEqual({left: 0, top: 0, right: 100, bottom: 50});
        expect(laidOut.clip("plain")).toEqual({left: 10, top: 5, right: 40, bottom: 15});
        expect(laidOut.clip("inner")).toEqual({left: 10, top: 5, right: 40, bottom: 15});
        expect(laidOut.rect("inner")).toEqual({x: 30, y: 7, width: 40, height: 20});
        expect(laidOut.clip("leaf")).toEqual({left: 30, top: 7, right: 40, bottom: 15});
    });

    test("a clip that does not overlap its ancestors' collapses to an empty rect", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [{
                name: "box",
                size: fixed(4, 4),
                container: {clip: true},
                children: [{
                    name: "away",
                    size: fixed(2, 2),
                    offset: {x: 10, y: 10},
                    container: {clip: true},
                    children: [box("leaf", 1, 1)],
                }],
            }],
        }, 20, 20);
        const clip = laidOut.clip("leaf");
        expect(clip.right - clip.left).toBe(0);
        expect(clip.bottom - clip.top).toBe(0);
    });

    test("a border takes one unit on each side, in the fit size and in front of the padding", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [{
                name: "panel",
                border: "single",
                container: {direction: "row", paddingLeft: 2, paddingTop: 1, gap: 1},
                children: [box("a", 3, 2), box("b", 4, 1)],
            }],
        });
        expect(laidOut.rect("panel")).toEqual({x: 0, y: 0, width: 1 + 2 + 3 + 1 + 4 + 1, height: 1 + 1 + 2 + 1});
        expect(laidOut.rect("a")).toEqual({x: 3, y: 2, width: 3, height: 2});
        expect(laidOut.rect("b")).toEqual({x: 7, y: 2, width: 4, height: 1});
    });

    test("every border style insets by one unit and a box without a border insets by none", () => {
        for (const border of ["single", "double", "thick"] as const) {
            const laidOut = layOut({name: "root", border, children: [{name: "text", text: "hi"}]}, 10, 5);
            expect(laidOut.rect("text")).toEqual({x: 1, y: 1, width: 8, height: 1});
        }
        const unbordered = layOut({name: "root", border: "none", children: [{name: "text", text: "hi"}]}, 10, 5);
        expect(unbordered.rect("text")).toEqual({x: 0, y: 0, width: 10, height: 1});
    });

    test("a bordered text node wraps inside its border and grows by it", () => {
        const laidOut = layOut({
            name: "root",
            container: {direction: "row", align: "start"},
            children: [{name: "text", border: "double", text: "aa bb", wrap: "word", size: {widthMode: "fixed", width: 4}}],
        });
        expect(laidOut.rect("text")).toEqual({x: 0, y: 0, width: 4, height: 2 + 2});
    });

    test("a clipping bordered container clips its children inside the border", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [{name: "panel", border: "single", container: {clip: true}, size: fixed(6, 4), children: [box("leaf", 10, 10)]}],
        });
        expect(laidOut.clip("leaf")).toEqual({left: 1, top: 1, right: 5, bottom: 3});
    });

    test("positions stay fractional", () => {
        const laidOut = layOut({name: "root", container: {direction: "row", justify: "center"}, children: [box("a", 1, 1)]}, 4, 1);
        expect(laidOut.rect("a").x).toBe(1.5);
    });

    test("a layout instance reused for a larger tree grows and lays it out the same", () => {
        const layout = new FlexLayout();
        const small = treeOf({name: "root", children: [box("a", 1, 1)]});
        layout.layout(small.tree, 0, 10, 10);
        const rows: NodeSpec[] = [];
        for (let i = 0; i < 40; i++) rows.push(box(`row${i}`, 1, 1));
        const large = treeOf({name: "root", container: {align: "start"}, children: rows});
        layout.layout(large.tree, 0, 10, 100);
        expect(layout.y[large.indexOf.get("row39")!]).toBe(39);
    });

    test("auto reserves a scrollbar column only when the content overflows, and the children and their clip give it up", () => {
        const fits = scrollList({scrollbar: "auto"}, textRows(2));
        expect(fits.rect("row0").width).toBe(10);
        expect(fits.clip("row0").right).toBe(10);
        expect(fits.verticalScrollbar("list")).toEqual(HIDDEN_SCROLLBAR);

        const overflows = scrollList({scrollbar: "auto"}, textRows(10));
        expect(overflows.rect("row0").width).toBe(9);
        expect(overflows.clip("row0")).toEqual({left: 0, top: 0, right: 9, bottom: 4});
        expect(overflows.verticalScrollbar("list")).toEqual({x: 9, y: 0, length: 4, thumbStart: 0, thumbLength: 2});
        expect(overflows.horizontalScrollbar("list")).toEqual(HIDDEN_SCROLLBAR);
        expect(overflows.scroll("list")).toEqual({x: 0, y: 0, contentWidth: 10, contentHeight: 10});
    });

    test("always reserves the column without overflow, and a fit scroll node grows by it like a border", () => {
        const fixedList = scrollList({scrollbar: "always"}, textRows(2));
        expect(fixedList.rect("row0").width).toBe(9);
        expect(fixedList.verticalScrollbar("list")).toEqual({x: 9, y: 0, length: 4, thumbStart: 0, thumbLength: 4});

        const fitList = scrollList({scrollbar: "always"}, [{name: "a", text: "abc"}, {name: "b", text: "de"}], {});
        expect(fitList.rect("list")).toEqual({x: 0, y: 0, width: 4, height: 2});
        expect(fitList.rect("a").width).toBe(3);
        expect(fitList.verticalScrollbar("list")).toEqual({x: 3, y: 0, length: 2, thumbStart: 0, thumbLength: 2});
    });

    test("never reserves nothing, even when the content overflows", () => {
        const laidOut = scrollList({scrollbar: "never"}, textRows(10));
        expect(laidOut.rect("row0").width).toBe(10);
        expect(laidOut.verticalScrollbar("list")).toEqual(HIDDEN_SCROLLBAR);
        expect(laidOut.scroll("list").contentHeight).toBe(10);
    });

    test("an overflowing auto scroll node arranges its children once more at the narrower width, so wrapped text rewraps", () => {
        const laidOut = scrollList({scrollbar: "auto"}, [{name: "wrapped", text: "aaaaa bbbb", wrap: "word"}, ...textRows(3)], fixed(10, 3));
        expect(laidOut.rect("wrapped")).toEqual({x: 0, y: 0, width: 9, height: 2});
        expect(laidOut.rect("row0").y).toBe(2);
        expect(laidOut.scroll("list").contentHeight).toBe(5);
        expect(laidOut.verticalScrollbar("list").length).toBe(3);
    });

    test("the thumb follows the clamped offset along the track", () => {
        expect(scrollList({scrollbar: "auto", scrollY: 3}, textRows(10)).verticalScrollbar("list").thumbStart).toBe(1);
        expect(scrollList({scrollbar: "auto", scrollY: 50}, textRows(10)).verticalScrollbar("list").thumbStart).toBe(2);
    });

    test("a bordered scroll node keeps its tracks inside the border, and with both axes the corner unit stays empty", () => {
        const laidOut = layOut({
            name: "root",
            container: {align: "start"},
            children: [{name: "list", size: fixed(10, 6), border: "single", scroll: {axes: "both", scrollbar: "auto"}, children: [box("wide", 20, 10)]}],
        }, 30, 30);
        expect(laidOut.verticalScrollbar("list")).toEqual({x: 8, y: 1, length: 3, thumbStart: 1, thumbLength: 1});
        expect(laidOut.horizontalScrollbar("list")).toEqual({x: 1, y: 4, length: 7, thumbStart: 1, thumbLength: 3});
        expect(laidOut.scroll("list")).toEqual({x: 0, y: 0, contentWidth: 23, contentHeight: 13});
        expect(laidOut.clip("wide")).toEqual({left: 1, top: 1, right: 8, bottom: 4});
    });
});
