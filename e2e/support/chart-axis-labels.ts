import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { histogramSection } from "./stats-panels";
import { spectraPlot } from "./spectra-plot";

// CT-156 / CT-100 / manual section 26: the chart axes render large and small
// magnitudes in scientific notation with a real SUPERSCRIPT exponent ("6.000×10⁴",
// "4.000×10⁻⁷"), never machine notation ("6.6e+4"). The histogram value axis spans
// the active band's min..max (a float band carries the extreme magnitudes), the
// histogram count axis labels pixel counts, and the spectra plot Y axis labels the
// pinned-pixel value range. Each axis exposes its labels through a stable hook: the
// two histogram axis columns carry data-testid, the spectra ticks are <text> nodes.

const SUPERSCRIPT_MAGNITUDE = /×10[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/;
const SUPERSCRIPT_NEGATIVE_EXPONENT = /×10⁻/;
const SUPERSCRIPT_LARGE_EXPONENT = /×10[²³⁴⁵⁶⁷⁸⁹]/;
const MACHINE_EXPONENTIAL_NOTATION = /\d[eE][+-]?\d/;

export function histogramValueAxisLabelsColumn(page: Page): Locator {
  return histogramSection(page).getByTestId("histogram-value-axis");
}

export function histogramCountAxisLabelsColumn(page: Page): Locator {
  return histogramSection(page).getByTestId("histogram-count-axis");
}

export async function readHistogramValueAxisLabels(page: Page): Promise<string[]> {
  return readSpanTextsWithin(histogramValueAxisLabelsColumn(page));
}

export async function readHistogramCountAxisLabels(page: Page): Promise<string[]> {
  return readSpanTextsWithin(histogramCountAxisLabelsColumn(page));
}

// SVG <text> nodes have no innerText (allInnerTexts yields undefined for each), so the
// spectra ticks are read through textContent (CT-351).
export async function readSpectraPlotAxisLabels(page: Page): Promise<string[]> {
  return spectraPlot(page).locator("text").allTextContents();
}

async function readSpanTextsWithin(column: Locator): Promise<string[]> {
  return column.locator("span").allInnerTexts();
}

export async function readAllChartAxisLabels(page: Page): Promise<string[]> {
  const [value, count, spectra] = await Promise.all([
    readHistogramValueAxisLabels(page),
    readHistogramCountAxisLabels(page),
    readSpectraPlotAxisLabels(page),
  ]);
  return [...value, ...count, ...spectra];
}

export function expectLabelsUseSuperscriptNotMachineNotation(labels: ReadonlyArray<string>): void {
  expect(labels.some((label) => SUPERSCRIPT_MAGNITUDE.test(label))).toBe(true);
  expect(labels.filter((label) => MACHINE_EXPONENTIAL_NOTATION.test(label))).toEqual([]);
}

export function expectLabelsCoverLargeAndSmallSuperscripts(labels: ReadonlyArray<string>): void {
  expect(labels.some((label) => SUPERSCRIPT_LARGE_EXPONENT.test(label))).toBe(true);
  expect(labels.some((label) => SUPERSCRIPT_NEGATIVE_EXPONENT.test(label))).toBe(true);
}

export function expectAxisLabelIsSuperscriptCount(labels: ReadonlyArray<string>, expected: string): void {
  expect(labels).toContain(expected);
  expect(labels).toContain("0");
}
