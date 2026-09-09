import { describe, expect, it } from "vitest";

import {
  convertCanvasPixelToImagePixelClamped,
  convertCanvasPixelToImagePixelOrNull,
  convertImagePixelToCanvasPointOrNull,
} from "./canvas-to-image-pixel";

const IDENTITY_FIT_SCALE = { x: 1, y: 1 };
const IDENTITY_PAN = { x: 0, y: 0 };
const IDENTITY_ZOOM = 1;

describe("convertCanvasPixelToImagePixelOrNull", () => {
  it("maps the canvas top-left to the image top-left under identity transform", () => {
    const result = convertCanvasPixelToImagePixelOrNull({
      canvasPointPx: { x: 0, y: 0 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it("maps the canvas centre to the image centre under identity transform", () => {
    const result = convertCanvasPixelToImagePixelOrNull({
      canvasPointPx: { x: 50, y: 50 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toEqual({ x: 100, y: 50 });
  });

  it("clamps the canvas bottom-right corner to the last image pixel", () => {
    const result = convertCanvasPixelToImagePixelOrNull({
      canvasPointPx: { x: 100, y: 100 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toEqual({ x: 199, y: 99 });
  });

  it("returns null when the cursor is on the letterbox above a fitted landscape image", () => {
    const result = convertCanvasPixelToImagePixelOrNull({
      canvasPointPx: { x: 50, y: 5 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: { x: 1, y: 0.5 },
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toBeNull();
  });

  it("respects user zoom and pan when projecting back to image space", () => {
    const result = convertCanvasPixelToImagePixelOrNull({
      canvasPointPx: { x: 50, y: 50 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 100, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: 2,
      userPan: { x: 0.5, y: 0.5 },
    });
    expect(result).toEqual({ x: 37, y: 62 });
  });

  it("returns null when the display has zero area", () => {
    const result = convertCanvasPixelToImagePixelOrNull({
      canvasPointPx: { x: 0, y: 0 },
      displaySize: { width: 0, height: 0 },
      imageSize: { width: 100, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toBeNull();
  });
});

describe("convertCanvasPixelToImagePixelClamped", () => {
  it("clamps a point beyond the right edge to the last column", () => {
    const result = convertCanvasPixelToImagePixelClamped({
      canvasPointPx: { x: 140, y: 50 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toEqual({ x: 199, y: 50 });
  });

  it("clamps a point beyond the left edge to the first column", () => {
    const result = convertCanvasPixelToImagePixelClamped({
      canvasPointPx: { x: -40, y: 50 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toEqual({ x: 0, y: 50 });
  });

  it("clamps a point beyond the bottom edge to the last row", () => {
    const result = convertCanvasPixelToImagePixelClamped({
      canvasPointPx: { x: 50, y: 95 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: { x: 1, y: 0.5 },
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toEqual({ x: 100, y: 99 });
  });

  it("maps an inside point identically to the OrNull variant", () => {
    const inputs = {
      canvasPointPx: { x: 50, y: 50 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    };
    expect(convertCanvasPixelToImagePixelClamped(inputs)).toEqual(
      convertCanvasPixelToImagePixelOrNull(inputs),
    );
  });

  it("returns null when the display has zero area", () => {
    const result = convertCanvasPixelToImagePixelClamped({
      canvasPointPx: { x: 0, y: 0 },
      displaySize: { width: 0, height: 0 },
      imageSize: { width: 100, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toBeNull();
  });
});

describe("convertImagePixelToCanvasPointOrNull", () => {
  it("maps the image top-left to the canvas top-left under identity transform", () => {
    const result = convertImagePixelToCanvasPointOrNull({
      imagePixelPoint: { x: 0, y: 0 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it("maps the image bottom-right to the canvas bottom-right under identity transform", () => {
    const result = convertImagePixelToCanvasPointOrNull({
      imagePixelPoint: { x: 200, y: 100 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 200, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it("respects user zoom and pan when projecting forward to canvas space", () => {
    const result = convertImagePixelToCanvasPointOrNull({
      imagePixelPoint: { x: 50, y: 50 },
      displaySize: { width: 100, height: 100 },
      imageSize: { width: 100, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: 2,
      userPan: { x: 0.5, y: 0.5 },
    });
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(75, 5);
    expect(result!.y).toBeCloseTo(25, 5);
  });

  it("returns null when the display has zero area", () => {
    const result = convertImagePixelToCanvasPointOrNull({
      imagePixelPoint: { x: 10, y: 10 },
      displaySize: { width: 0, height: 0 },
      imageSize: { width: 100, height: 100 },
      fitScale: IDENTITY_FIT_SCALE,
      userZoom: IDENTITY_ZOOM,
      userPan: IDENTITY_PAN,
    });
    expect(result).toBeNull();
  });
});
