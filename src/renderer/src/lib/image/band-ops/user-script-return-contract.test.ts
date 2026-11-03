import { describe, expect, it } from "vitest";

import {
  SCRIPTING_DOCS_HINT,
  UserScriptReturnContractError,
  validateBandSelectionReturnValue,
  validateBandWeightVectorReturnValue,
  validatePerBandNumberListReturnValue,
  type PerBandNumberListSubject,
} from "./user-script-return-contract";

describe("validateBandWeightVectorReturnValue", () => {
  it("accepts an N-length numeric vector matching the band count", () => {
    expect(validateBandWeightVectorReturnValue([0.5, -1, 2], 3)).toEqual([0.5, -1, 2]);
  });

  it("rejects a vector whose length does not match the band count", () => {
    expect(() => validateBandWeightVectorReturnValue([1, 2], 3)).toThrow(UserScriptReturnContractError);
  });

  it("rejects a non-array return value", () => {
    expect(() => validateBandWeightVectorReturnValue(5, 1)).toThrow(/must be an array/);
  });

  it("rejects NaN and Infinity weights", () => {
    expect(() => validateBandWeightVectorReturnValue([1, NaN, 3], 3)).toThrow(/finite number/);
    expect(() => validateBandWeightVectorReturnValue([1, Infinity, 3], 3)).toThrow(/finite number/);
  });

  it("rejects a non-numeric weight", () => {
    expect(() => validateBandWeightVectorReturnValue([1, "2", 3], 3)).toThrow(UserScriptReturnContractError);
  });

  it("includes the docs hint in the error message", () => {
    expect(() => validateBandWeightVectorReturnValue([], 1)).toThrow(SCRIPTING_DOCS_HINT);
  });
});

describe("validateBandSelectionReturnValue", () => {
  const dimensions = { height: 2, width: 3 };

  it("accepts an H x W numeric band matching the cube's spatial dims", () => {
    const band = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(validateBandSelectionReturnValue(band, dimensions)).toEqual(band);
  });

  it("rejects a band with the wrong number of rows", () => {
    expect(() => validateBandSelectionReturnValue([[1, 2, 3]], dimensions)).toThrow(/2 rows/);
  });

  it("rejects a row with the wrong number of columns", () => {
    const band = [
      [1, 2, 3],
      [4, 5],
    ];
    expect(() => validateBandSelectionReturnValue(band, dimensions)).toThrow(/3 columns/);
  });

  it("rejects NaN or Infinity pixels", () => {
    const band = [
      [1, 2, 3],
      [4, NaN, 6],
    ];
    expect(() => validateBandSelectionReturnValue(band, dimensions)).toThrow(/finite number/);
  });

  it("rejects a row that is not an array", () => {
    expect(() => validateBandSelectionReturnValue([[1, 2, 3], 4], dimensions)).toThrow(
      UserScriptReturnContractError,
    );
  });
});

// CT-318: the same one-number-per-band contract, named for its consumer.
describe("validatePerBandNumberListReturnValue", () => {
  const npcScores: PerBandNumberListSubject = {
    listName: "The Potential Contrast score list",
    elementName: "Potential Contrast score",
    onePerBandPhrase: "one Potential Contrast score per band",
  };

  it("accepts a list holding one finite number per band", () => {
    expect(validatePerBandNumberListReturnValue([0.5, 1], 2, npcScores)).toEqual([0.5, 1]);
  });

  it("names the consumer's subject when the length is wrong", () => {
    expect(() => validatePerBandNumberListReturnValue([0.5], 3, npcScores)).toThrow(
      "The Potential Contrast score list must have one Potential Contrast score per band (expected 3, got 1).",
    );
  });

  it("names the consumer's element when an entry is not a finite number", () => {
    expect(() => validatePerBandNumberListReturnValue([0.5, Number.NaN], 2, npcScores)).toThrow(
      /Potential Contrast score 2 must be a finite number/,
    );
  });

  it("refuses a bare number where a per-band list is required", () => {
    expect(() => validatePerBandNumberListReturnValue(0.5, 1, npcScores)).toThrow(
      /The Potential Contrast score list must be an array/,
    );
  });
});
