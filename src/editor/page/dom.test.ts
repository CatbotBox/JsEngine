import {describe, expect, test} from "../../engine/testing/harness";
import {isDomElement, isDomNode, isHtmlElement, isTextEntryElement, isValueInputElement} from "./dom";

const XHTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function element(tagName: string, namespaceURI: string = XHTML, fields: Record<string, unknown> = {}): unknown {
    return {nodeType: ELEMENT_NODE, namespaceURI, tagName, ...fields};
}

describe("realm-safe DOM checks", () => {
    test("nodes and elements are told apart by their node type, not by the realm's constructors", () => {
        expect(isDomNode({nodeType: TEXT_NODE})).toBe(true);
        expect(isDomNode(null)).toBe(false);
        expect(isDomNode({nodeType: "1"})).toBe(false);
        expect(isDomElement({nodeType: TEXT_NODE})).toBe(false);
        expect(isDomElement(element("DIV"))).toBe(true);
    });

    test("HTML elements are elements in the XHTML namespace", () => {
        expect(isHtmlElement(element("DIV"))).toBe(true);
        expect(isHtmlElement(element("svg", SVG))).toBe(false);
        expect(isHtmlElement(undefined)).toBe(false);
    });

    test("inputs and text areas hold editable values, whatever their type", () => {
        expect(isValueInputElement(element("INPUT", XHTML, {type: "checkbox"}))).toBe(true);
        expect(isValueInputElement(element("TEXTAREA"))).toBe(true);
        expect(isValueInputElement(element("SELECT"))).toBe(false);
        expect(isValueInputElement(element("input", SVG))).toBe(false);
    });

    test("text entry still counts selects, text inputs and editable content", () => {
        expect(isTextEntryElement(element("INPUT", XHTML, {type: "text"}) as Element)).toBe(true);
        expect(isTextEntryElement(element("INPUT", XHTML, {type: "checkbox"}) as Element)).toBe(false);
        expect(isTextEntryElement(element("SELECT") as Element)).toBe(true);
        expect(isTextEntryElement(element("DIV", XHTML, {isContentEditable: true}) as Element)).toBe(true);
        expect(isTextEntryElement(null)).toBe(false);
    });
});
