import {describe, expect, test} from "../../engine/testing/harness";
import {fillProjectPage, projectPageHtml} from "./projectPage";
import type {ProjectPageFields} from "./projectPage";

const FIELDS: ProjectPageFields = {
    title: "Rock & <Roll> \"Deluxe\"",
    defaultBackend: "cells",
    script: "rock.js",
    stylesheet: "demo.css",
    isolationScript: "coi-serviceworker.js",
};

describe("project page template", () => {
    test("fills every field and escapes the manifest name for HTML", () => {
        const html = fillProjectPage("<title>{{title}}</title><html data-default-backend=\"{{defaultBackend}}\"><script src=\"{{script}}\">", FIELDS);
        expect(html).toBe("<title>Rock &amp; &lt;Roll&gt; &quot;Deluxe&quot;</title><html data-default-backend=\"cells\"><script src=\"rock.js\">");
    });

    test("leaves the page default backend empty when the manifest sets none, so the bootstrap falls back to its own default", () => {
        expect(fillProjectPage("{{defaultBackend}}", {...FIELDS, defaultBackend: undefined})).toBe("");
    });

    test("a field the build does not fill is an error, not a literal token on the page", () => {
        expect(() => fillProjectPage("{{subtitle}}", FIELDS)).toThrow("{{subtitle}}");
        expect(() => fillProjectPage("{{constructor}}", FIELDS)).toThrow("{{constructor}}");
    });

    test("the shipped template loads the isolation script, the stylesheet and the bootstrap, and has the elements the world page needs", () => {
        const html = projectPageHtml(FIELDS);
        for (const expected of ["<script src=\"coi-serviceworker.js\">", "href=\"demo.css\"", "<script type=\"module\" src=\"rock.js\">", "id=\"terminal\"", "id=\"focus-hint\"", "id=\"play\""]) {
            expect(html.includes(expected)).toBe(true);
        }
        expect(html.includes("{{")).toBe(false);
    });
});
