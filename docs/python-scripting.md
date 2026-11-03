# Python scripting in CHARM Toolbox

Three operations in the toolbox can run your own Python against the current stack:

- **Band weighting**: your code returns one weight per band and the toolbox builds a weighted average band.
- **Band selection**: your code returns a single computed band.
- **Custom transform**: your code returns a whole new cube, which the toolbox opens as a new stack.

Every result opens in a new panel by default, with an entry in the stack's audit trail.

## Run, then Apply

When your code runs depends on the operation:

- **Band weighting and band selection**: Run formula or Import script... executes your code immediately, and the panel reports the ready result. Click Apply to commit that result; no Python runs at Apply time. The staged result is discarded when you close the operation panel or switch to another operation.
- **Custom transform**: typing a formula or importing a tool only configures the transform; the status line reports what is set, for example "Tool loaded: my-tool.py". Click Apply to run your code on the stack and open the transformed result. If the run fails, the panel stays open with your formula or tool still set, and the script file is re-read on every Apply, so you can fix the file in your editor and click Apply again.

## Two ways to provide code

### The inline formula

A formula is a single Python expression evaluated against `cube` (the stack as a numpy array) and `np` (numpy). You do not write a function: the toolbox wraps your expression as `def run(cube): return <your expression>`.

A formula must be one expression. Multi-statement input is rejected, so use an imported script when you need several lines.

Worked example: weight each band by its own variance. This returns an N-length weight vector, so it suits band weighting.

```python
cube.var(axis=(1, 2))
```

### Imported .py or .zip tools

Import a single `.py` file or a `.zip` of a multi-module tool. Your code must define a top-level `run(cube, wavelengths=None)` function that returns the result.

For a `.zip`, the required entry is a top-level `main.py` that defines `run`. The archive is extracted with its folder on the import path, so imports between your own modules resolve. A `.zip` without a top-level `main.py` defining `run` is rejected.

Worked example: a `main.py` that averages a 3-band stack with fixed per-band weights. This returns a height-by-width band, so it suits band selection.

```python
import numpy as np


def run(cube, wavelengths=None):
    weights = np.array([0.2, 0.3, 0.5])
    return np.tensordot(weights, cube, axes=(0, 0)) / weights.sum()
```

## The cube your code receives

`cube` is a numpy array of shape `(bands, height, width)`: `cube[k]` is band k as a height-by-width picture. `wavelengths`, when the stack carries them, is a one-per-band sequence; it is `None` otherwise, so give it a default.

## What your code must return

The expected return depends on which operation runs your code:

- **Band weighting**: an N-length weight vector, one weight per band of the stack.
- **Band selection**: a single height-by-width band matching the stack's spatial size.
- **Custom transform**: a cube of shape `(N, height, width)` with any dimensions >= 1. The output band count N is free (any value of 1 or more), and the spatial dimensions (height, width) are also free - returning a crop, a resized stack, or any shape different from the source is valid. When the output band count equals the source's, wavelengths and band labels carry through to the new stack; otherwise the new stack gets generic band labels and no wavelengths.

Every return must be numeric and finite: a result containing NaN or Inf is rejected.

## Bundled packages

The bundled runtime is CPython 3.12 with the packages below preinstalled, so a script can import any of them with no setup. The set and versions come from the sample analysis environments collected in July 2026; where a sample pin could not run on this runtime (Python 3.12 with numpy 2), the nearest compatible release is bundled instead, noted per row. Anything not listed here needs your own Python environment (below).

| Package | Version | Import as | Note |
| --- | --- | --- | --- |
| numpy | 2.5.0 | `numpy` | |
| scipy | 1.18.0 | `scipy` | |
| scikit-image | 0.26.0 | `skimage` | |
| scikit-learn | 1.8.0 | `sklearn` | |
| pandas | 2.3.3 | `pandas` | bumped from the sample 1.5.2, which needs numpy 1 |
| matplotlib | 3.10.8 | `matplotlib` | renders in memory (Agg); the sandbox blocks saving figures to disk |
| seaborn | 0.13.2 | `seaborn` | bumped from the sample 0.11.2, which needs pandas 1 |
| opencv-python | 4.13.0.92 | `cv2` | bumped from the sample 4.9.0.80, which needs numpy 1 |
| pillow | 12.1.1 | `PIL` | |
| sympy | 1.14.0 | `sympy` | |
| spectral | 0.25 | `spectral` | bumped from the sample 0.22.4, which predates numpy 2 |
| tifffile | 2024.8.30 | `tifffile` | |
| pyvips | 3.1.1 | `pyvips` | ships with its own libvips binary |
| joblib | 1.5.3 | `joblib` | |
| requests | 2.32.5 | `requests` | importable, but the sandbox blocks network access in bundled mode |
| pyyaml | 6.0.3 | `yaml` | |

## The sandbox (bundled mode)

By default your code runs sandboxed so a buggy or hostile script cannot touch your machine:

- No filesystem or network access.
- Imports limited to the bundled packages plus a curated pure-compute part of the standard library (an import allowlist).
- A wall-clock time limit (see the limits below).
- A memory bound (about 4 GB of address space on macOS and Linux).

A script that exceeds these is stopped and surfaced as an error.

## Wall-clock limits

Each limit grows with the stack: on top of its base, a run gets 60 seconds per gibibyte of stack data for each direction the stack crosses (in for weighting/selection runs; in and out for custom transform runs).

- Band weighting and band selection runs: 30 seconds, plus the transfer allowance.
- Custom transform (cube) runs: 120 seconds, plus the transfer allowance in each direction.

A run whose stack would not fit in the machine's memory is refused before any data moves.

The limit measures SILENCE, not total run time. A script that takes a third `params` argument can call `params["report_progress"](fraction)` as it works, which both drives the progress bar and starts its time budget again, so a long run that keeps reporting is never stopped for taking its time. Use Stop to end one early.

## Your own Python environment (opt-in)

For a tool with arbitrary third-party dependencies, point the toolbox at your own interpreter or virtual environment under Custom Script > Python Environment. This own environment is trusted and unsandboxed, so only run code you trust; the wall-clock and memory limits still apply. The toolbox never installs packages.

## Template scripts

Copy a template from [`docs/examples/`](examples/) and start from a working file:

- [`weighting-template.py`](examples/weighting-template.py): returns an N-length weight vector for band weighting.
- [`selection-template.py`](examples/selection-template.py): returns a height-by-width band for band selection.
- [`transform-template.py`](examples/transform-template.py): returns an (N, height, width) cube for custom transform.
- [`zip-tool-template/`](examples/zip-tool-template/): a multi-module tool whose required top-level [`main.py`](examples/zip-tool-template/main.py) imports a sibling [`helpers.py`](examples/zip-tool-template/helpers.py). Zip the folder's contents (with `main.py` at the archive root) and import the `.zip`.
