# Built-in Random Orthogonal Projection (ROP) for CHARM Toolbox.
#
# Adapted from tasks/client-code/ROP.py (Anna Breger, July 2026).
#
# Adaptations from the original script (randOrth is verbatim apart from the
# injected generator):
# - The original is a top-level script that opens an image with PIL and shows
#   the projections with matplotlib. This version exposes
#   run(cube, wavelengths, params); no file I/O, no plotting.
# - CT-336: the cube arrives band-major (bands, height, width) and is projected
#   IN PLACE with np.tensordot(cube, Q, axes=([0], [0])) (sum over the band
#   axis, result (height, width, k)), so there is NO transposed second copy of
#   the cube in the worker. Anna's script transposed to (height, width, bands)
#   first and contracted axis 2; both contract the band axis, so a seed S draws
#   the identical projection either way (the pinned references are recomputed
#   over this formulation and stay within 1e-4 of the transposed one). The
#   projected bands are returned band-major.
# - Randomness comes from a per-run seeded numpy Generator (params["seed"]) so
#   every press is reproducible; the original drew from the global RandomState.
# - k is fixed at 1 (the toolbox always projects to one band per draw) and n
#   comes from params["count"] (default 1: one candidate per press).
# - The original notes the projections must be normalized before VIEWING; the
#   raw projected values are returned as the data (display normalization is the
#   app's job).
# - Progress is reported through params["report_progress"].

import numpy as np


# computes n orthogonal projections d->k
def randOrth(d, k, n, rng):
    randomSet = []
    while len(randomSet) < n:
        [Q, R] = np.linalg.qr(rng.normal(size=(d, k)))
        randomSet.append(Q)
    return randomSet


# projects the band-major cube (bands, height, width) onto each Q by contracting
# the band axis, without allocating a transposed copy of the cube
def dimReduction(cube, projections):
    l = []
    for Q in projections:
        l.append(np.tensordot(cube, Q, axes=([0], [0])))
    return l


def run(cube, wavelengths, params):
    report_progress = params.get("report_progress") or (lambda fraction: None)
    seed = int(params["seed"])
    count = int(params.get("count", 1))
    if count < 1:
        raise ValueError("count must be at least 1")
    rng = np.random.default_rng(seed)

    projections = randOrth(cube.shape[0], 1, count, rng)
    report_progress(0.5)
    reconstruction = dimReduction(cube, projections)
    report_progress(1.0)
    return np.stack([r[:, :, 0] for r in reconstruction], axis=0)
