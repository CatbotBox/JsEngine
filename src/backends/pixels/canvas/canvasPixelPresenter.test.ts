import {describe, expect, test} from "../../../engine/testing/harness";
import {RGBA_BYTES_PER_PIXEL} from "../pixelFrame";
import type {PixelFrame} from "../pixelFrame";
import {CanvasPixelPresenter} from "./canvasPixelPresenter";
import type {CanvasPixelContext, PixelImageData} from "./canvasPixelPresenter";

const PIXELS_PER_UNIT_X = 8, PIXELS_PER_UNIT_Y = 16;

class RecordingContext implements CanvasPixelContext<PixelImageData> {
    public readonly created: {width: number, height: number}[] = [];
    public readonly puts: {image: PixelImageData, x: number, y: number, bytes: number[]}[] = [];

    public createImageData(width: number, height: number): PixelImageData {
        this.created.push({width, height});
        return {width, height, data: new Uint8ClampedArray(width * height * RGBA_BYTES_PER_PIXEL)};
    }

    public putImageData(image: PixelImageData, x: number, y: number): void {
        this.puts.push({image, x, y, bytes: Array.from(image.data)});
    }
}

function frame(widthPx: number, heightPx: number, firstByte: number): PixelFrame {
    const rgba = new Uint8ClampedArray(widthPx * heightPx * RGBA_BYTES_PER_PIXEL);
    rgba[0] = firstByte;
    return {widthPx, heightPx, rgba, pixelsPerScreenUnitX: PIXELS_PER_UNIT_X, pixelsPerScreenUnitY: PIXELS_PER_UNIT_Y};
}

function presenterOn(width: number, height: number) {
    const canvas = {width, height};
    const context = new RecordingContext();
    return {canvas, context, presenter: new CanvasPixelPresenter({canvas, context})};
}

describe("CanvasPixelPresenter", () => {
    test("puts each frame's bytes at the canvas origin, reusing one image while the size holds", () => {
        const {context, presenter} = presenterOn(2, 1);
        presenter.present(frame(2, 1, 7));
        presenter.present(frame(2, 1, 9));
        expect(context.created).toEqual([{width: 2, height: 1}]);
        expect(context.puts.map(put => [put.x, put.y, put.bytes[0]])).toEqual([[0, 0, 7], [0, 0, 9]]);
        expect(context.puts[0].image).toBe(context.puts[1].image);
        presenter.present(frame(1, 1, 3));
        expect(context.created).toEqual([{width: 2, height: 1}, {width: 1, height: 1}]);
    });

    test("reports the canvas size and resizes the canvas, notifying listeners only on a change", () => {
        const {canvas, presenter} = presenterOn(4, 3);
        expect(presenter.size()).toEqual({widthPx: 4, heightPx: 3});
        let notified = 0;
        const stop = presenter.onResize(() => notified++);
        presenter.resize(4, 3);
        presenter.resize(10, 6);
        expect([canvas.width, canvas.height, notified]).toEqual([10, 6, 1]);
        stop();
        presenter.resize(1, 1);
        expect(notified).toBe(1);
    });

    test("an empty frame draws nothing", () => {
        const {context, presenter} = presenterOn(0, 0);
        presenter.present(frame(0, 0, 0));
        expect([context.created.length, context.puts.length]).toEqual([0, 0]);
    });
});
