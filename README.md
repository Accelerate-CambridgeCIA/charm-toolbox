# CHARM Toolbox 
A Toolbox for Cultural Heritage Images Analysis & Recovery with extension to Multi-/Hyperspectral Data

This is output of the project "Non-invasive imaging and machine learning techniques for the reconstruction of degraded historical sheet music (PI: Dr Anna Breger)" funded by the Cambridge Centre for Data-Driven Discovery and Accelerate Programme through a donation of Schmidt Sciences. GUI: Evan Morgan (InScope), Methods: Anna Breger and Wallace Peaslee (DAMTP, University of Cambridge).  

[![Latest release](https://img.shields.io/github/v/release/in-scope/ciag-toolbox?include_prereleases)](../../releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)](../../releases)
[![Downloads](https://img.shields.io/github/downloads/in-scope/ciag-toolbox/total)](../../releases)

CHARM Toolbox is a desktop application for inspecting, processing and comparing images, built for image analysis in cultural heritage settings: museum imaging scientists, conservators, and researchers working with standard or multi/hyperspectral image data. This tool aims to give you a fast, focused side-by-side viewing surface without having to write a script every time you want to compare two renderings.

This is an early release and still in the stage of testing for a beta version. 

Note: The application never modifies the image file on disk. All adjustments are visual, applied only to what you see in the cell.

## Installation

Download the latest installer for your computer from the [Releases page](../../releases). Pick the file that matches your operating system, run it, and launch **CHARM Toolbox** from your Start menu (Windows) or Applications folder (macOS).

### Windows

1. From the [Releases page](../../releases), download the file ending in `Setup.exe`.
2. Double-click the installer and follow the prompts. Choose an install location and whether to add Start menu and desktop shortcuts.
3. Launch **CHARM Toolbox** from the Start menu.

### macOS

1. From the [Releases page](../../releases), download the `.dmg` that matches your Mac's CPU:
   - **Apple silicon** (M1, M2, M3, M4, ...): the file ending in `arm64.dmg`.
   - **Intel**: the file ending in `x64.dmg`.

   If you are not sure which you have, click the Apple menu in the top-left of your screen, choose **About This Mac**, and look at the **Chip** or **Processor** line.
2. Open the `.dmg` and drag the **CHARM Toolbox** icon into your **Applications** folder.
3. **First launch only**: double-click **CHARM Toolbox** in your Applications folder. macOS will block it with a dialog saying it cannot be opened. Click **Done** to dismiss the dialog.
4. Click the Apple menu in the top-left of your screen and choose **System Settings**. In the sidebar, click **Privacy & Security**, then scroll down. Near the bottom you will see a message: *"MSI Toolbox was blocked to protect your Mac."* Click the **Open Anyway** button next to it.
5. macOS will prompt you to authenticate with Touch ID or your password, then show one more dialog. Click **Open Anyway** in that dialog too.
6. The app launches. From now on, double-clicking the icon works normally; this approval is one-time.

   This step is needed because the application is not signed by a paid Apple Developer account. Approving it through Privacy & Security is the standard, GUI-only way to grant the one-time exception.

## Getting Started

A five-minute first session.

1. **Launch the app.** You will see a single empty viewing cell labelled **No image loaded**, with an **Open image** button in the middle.
2. **Open an image.** Choose **File > Open Image...** from the menu, click the folder icon in the toolbar, or click the **Open image** button inside the empty cell. Pick any PNG or JPEG file. The image appears in the cell, and its filename appears in the cell's header strip.
3. **Pan and zoom.** Click-and-drag inside the cell to pan. Roll the mouse wheel to zoom in and out; the zoom is centered on your cursor, so you can drill into a feature just by hovering over it. Double-click anywhere in the cell to reset the view back to fit-to-cell.
4. **Switch to a multi-cell layout.** In the toolbar, click the grid icon and choose **2x2**. The work area splits into four cells, numbered 1 through 4. The image you opened stays in cell 1; cells 2-4 are empty, each with its own **Open image** button.
5. **Duplicate a cell.** Right-click your image (cell 1) and choose **Duplicate**. The image copies into the next empty cell (cell 2). The two copies are independent: you can pan, zoom, and adjust each one separately.
6. **Toggle normalized viewing on one cell.** In cell 2's header strip, click the contrast icon labelled **Normalized viewing**. Cell 2's image stretches each band to the full display range, which often reveals detail that was invisible in the raw view. Cell 1 is unchanged, so you can read the difference between raw and normalized side by side. Click the icon again to switch back to raw display.
7. **Compare bands and views across cells.** Because normalized viewing is a per-cell display setting, you can leave one cell raw and another normalized, or normalize each cell on a different band, and read the differences side by side. Nothing about the underlying image changes; everything is a visual adjustment.

That covers the full set of features in this release. The original image file on disk is untouched throughout; everything is a visual adjustment in the cell you are looking at.

## Keyboard and mouse reference

| Action | How |
|---|---|
| Open an image | **File > Open Image...**, the folder icon in the toolbar, or the **Open image** button inside an empty cell |
| Pan a cell | Click-and-drag inside the cell |
| Zoom a cell | Mouse wheel (centers on cursor) |
| Reset a cell to fit | Double-click inside the cell |
| Duplicate a cell | Right-click the cell, choose **Duplicate** |
| Toggle normalized viewing | Click the **Normalized viewing** contrast icon in the cell's header strip |
| Select a cell | Click the cell |
| Add a cell to the selection | Ctrl-click (Windows) or Cmd-click (macOS) the cell |
| Select a range of cells | Shift-click the cell at the end of the range |
| Clear selection | Click outside any cell |
| Apply an action to selected cells | Click the action in the toolbar; the confirm dialog uses your current selection as the pre-checked targets |
| Change theme | **View > Theme > System / Light / Dark** |

## End-to-end tests (developers)

The project ships a Playwright end-to-end suite that drives the real Electron main process and renderer. It is a local-only target; CI wiring is out of scope.

To run it:

1. In one terminal, start the dev server and app: `pnpm dev`. Wait until it prints `dev server running for the electron renderer process at: http://localhost:5173/`.
2. In a second terminal, run the suite: `pnpm e2e`.

Playwright launches its own Electron instance pointed at the running dev renderer, so a second app window appears alongside the one `pnpm dev` opens; that is expected. If your renderer dev server is not on the default `http://localhost:5173`, set `MSI_E2E_RENDERER_URL` before running `pnpm e2e`.

### Inspecting a test visually

The suite runs too fast to watch live. To see what a test actually did step by step, capture a Playwright trace and open it in the trace viewer. Set `MSI_E2E_TRACE=1` and the launcher records a trace per spec into `test-results/electron-traces/`, named after the spec.

Because the app renders into a WebGL canvas, the trace viewer's DOM-snapshot pane stays blank. Use the **screenshot filmstrip across the top** instead: those are real window captures (canvas included), and clicking any action in the list jumps the filmstrip to that moment and highlights the element the step targeted.

With `pnpm dev` already running, in Git Bash:

```bash
pnpm e2e:clean                                    # wipe previous artifacts (optional)
MSI_E2E_TRACE=1 pnpm e2e e2e/crop-to-region.spec.ts
npx playwright show-trace "$(ls -t test-results/electron-traces/*.zip | head -1)"
```

In PowerShell the env var is set inline differently:

```powershell
$env:MSI_E2E_TRACE=1; pnpm e2e e2e/crop-to-region.spec.ts; Remove-Item Env:MSI_E2E_TRACE
```

`pnpm e2e:clean` removes the `test-results/` directory (cross-platform). Normal `pnpm e2e` runs record nothing unless `MSI_E2E_TRACE` is set, so the suite stays fast by default.

## Reporting issues

Found a bug, a confusing label, or a workflow you wish was supported? Open an issue at the [Issues page](../../issues). Screenshots help.
