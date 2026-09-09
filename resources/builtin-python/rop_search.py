# Built-in ROP optimization search for CHARM Toolbox (CT-310).
#
# Where rop.py draws ONE candidate per press, this script loops many candidates
# inside a single run and returns only the best-scoring one, so searching ten
# thousand projections costs one worker spawn, one cube upload, and the memory
# of a single band.
#
# Design notes:
# - The candidate draw is rop.randOrth / rop.dimReduction called ONE candidate
#   at a time, so a search seeded with S explores exactly the same projections
#   rop.py would draw with seed S and count N, and the best band is bit-identical
#   to that candidate.
# - CT-336: like rop.py, this projects the band-major cube directly (no
#   np.transpose), so the only cube in the worker is the resident one and each
#   candidate allocates only its own output band.
# - The objective is chosen by params["objective"]: "npc" delegates to the
#   packaged npc.py, "cnr" is the locked contrast-to-noise formula (population
#   standard deviation, ddof = 0, mirroring the app's TS implementation), and
#   "custom" executes the user's objective script, whose SOURCE the app passes
#   in params - the same contract as any other imported tool, under the same
#   sandbox, with no file I/O in Python.
# - Progress is reported per candidate through params["report_progress"], which
#   is what makes the panel's bar determinate (and the run's wall clock treat a
#   long search as alive rather than wedged).
# - Candidates whose score is not finite are skipped; a search where none scored
#   finitely is an error rather than a silently arbitrary winner.

import inspect

import numpy as np

import npc
import rop

NO_FINITE_SCORE_MESSAGE = "No projection produced a finite score."
UNKNOWN_OBJECTIVE_MESSAGE = "The search needs an objective of 'npc', 'cnr' or 'custom'."
OBJECTIVE_MUST_RETURN_A_NUMBER_MESSAGE = "The objective script must return one finite number."


def run(cube, wavelengths, params):
    report_progress = params.get("report_progress") or (lambda fraction: None)
    count = read_projection_count(params)
    rng = np.random.default_rng(int(params["seed"]))
    score_candidate = build_objective_scorer(wavelengths, params)
    best = search_best_scoring_projection(cube, count, rng, score_candidate, report_progress)
    return np.stack([best], axis=0)


def read_projection_count(params):
    count = int(params.get("count", 1))
    if count < 1:
        raise ValueError("count must be at least 1")
    return count


def search_best_scoring_projection(cube, count, rng, score_candidate, report_progress):
    best_band = None
    best_score = None
    for index in range(count):
        band = project_one_candidate(cube, rng)
        score = score_candidate(band)
        if np.isfinite(score) and (best_score is None or score > best_score):
            best_band, best_score = band, score
        report_progress((index + 1) / count)
    if best_band is None:
        raise ValueError(NO_FINITE_SCORE_MESSAGE)
    return best_band


# One candidate through rop.py's own functions, so the search and a single
# press draw identical projections from identical generator states.
def project_one_candidate(cube, rng):
    projections = rop.randOrth(cube.shape[0], 1, 1, rng)
    return rop.dimReduction(cube, projections)[0][:, :, 0]


def build_objective_scorer(wavelengths, params):
    objective = params.get("objective")
    masks = params.get("masks") or []
    if objective == "cnr":
        return build_cnr_scorer(masks, params)
    if objective == "npc":
        return build_npc_scorer(masks, params)
    if objective == "custom":
        return build_custom_script_scorer(wavelengths, masks, params)
    raise ValueError(UNKNOWN_OBJECTIVE_MESSAGE)


# |mean of text pixels - mean of background pixels| / population standard
# deviation of the background pixels (CT-322: absolute value, the paper's
# definition, mirroring the app's TS implementation); the mask indexes address the uploaded
# category masks in the order the app sent them.
def build_cnr_scorer(masks, params):
    text = select_mask_at_index(masks, params, "text_mask_index")
    background = select_mask_at_index(masks, params, "background_mask_index")

    def score_candidate(band):
        return abs(np.mean(band[text]) - np.mean(band[background])) / np.std(band[background])

    return score_candidate


def select_mask_at_index(masks, params, parameterName):
    index = int(params[parameterName])
    if index < 0 or index >= len(masks):
        raise ValueError("The search objective names a mask category that was not sent.")
    selected = np.asarray(masks[index]) != 0
    if not np.any(selected):
        raise ValueError("A search objective category has no painted pixels.")
    return selected


def build_npc_scorer(masks, params):
    npc_params = {"masks": masks, "bins": int(params.get("bins", 255))}

    # CT-318: npc.run returns one score per band; the candidate is one band, so
    # the objective is the first (only) element and stays numerically unchanged.
    def score_candidate(band):
        return npc.run(band[np.newaxis, :, :], None, npc_params)[0]

    return score_candidate


def build_custom_script_scorer(wavelengths, masks, params):
    objective_run = load_objective_run_function(str(params.get("objective_source", "")))
    positional = count_positional_parameters(objective_run)
    objective_params = {"masks": masks, "report_progress": lambda fraction: None}

    def score_candidate(band):
        cube = band[np.newaxis, :, :]
        return coerce_objective_score(
            invoke_objective(objective_run, positional, cube, wavelengths, objective_params),
        )

    return score_candidate


def load_objective_run_function(objective_source):
    namespace = {"__name__": "__msi_objective_script__"}
    exec(compile(objective_source, "<objective-script>", "exec"), namespace)
    objective_run = namespace.get("run")
    if not callable(objective_run):
        raise RuntimeError("The objective script must define a run() function.")
    return objective_run


# Mirrors the worker bootstrap's arity dispatch so an objective script written
# for the toolbox's documented run(cube, wavelengths=None) keeps working.
def count_positional_parameters(objective_run):
    try:
        parameters = inspect.signature(objective_run).parameters.values()
    except (TypeError, ValueError):
        return 0
    kinds = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    return sum(1 for parameter in parameters if parameter.kind in kinds)


def invoke_objective(objective_run, positional, cube, wavelengths, params):
    if positional <= 1:
        return objective_run(cube)
    if positional == 2:
        return objective_run(cube, wavelengths)
    return objective_run(cube, wavelengths, params)


def coerce_objective_score(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(OBJECTIVE_MUST_RETURN_A_NUMBER_MESSAGE)
