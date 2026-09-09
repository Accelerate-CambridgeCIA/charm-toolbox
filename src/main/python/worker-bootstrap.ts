// The Python-side half of the worker IPC boundary, shipped as a source string and
// passed to the interpreter via `-c`. This shim is product infrastructure (framing,
// cube reconstruction, dispatch, error capture); only the formula/script it executes is
// user Python. It must mirror the frame layout in worker-protocol.ts exactly: the JSON
// request frame (4-byte uint32 length) is followed by a raw little-endian float32 cube
// frame (8-byte uint64 length, CT-241 - a uint32 caps the cube at 4 GiB) when the request
// header declares a cube. A resultKind "cube" run WRITES its raw little-endian float32
// result (band-major) to the request's cubeResultSpoolPath file and responds with ONE
// JSON completed frame naming the shape and spooled byte length (CT-214 as amended by
// CT-219g: a multi-gigabyte stdout frame makes the reading Electron main process
// allocate one over-2GiB buffer for all available pipe bytes, a fatal native OOM).
import { PYTHON_SANDBOX_INSTALL_SOURCE } from "./sandbox-policy";

export const PYTHON_WORKER_BOOTSTRAP_SOURCE = `
import inspect
import json
import struct
import sys
import traceback

REAL_STDOUT = sys.stdout.buffer
sys.stdout = sys.stderr

${PYTHON_SANDBOX_INSTALL_SOURCE}


def read_frame_payload(stream):
    header = stream.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    payload = stream.read(length)
    if len(payload) < length:
        return None
    return payload


def read_cube_frame_payload(stream):
    # The raw cube frame alone carries an 8-byte little-endian length (CT-241):
    # a uint32 prefix caps the cube at 4 GiB and the scale10 subset is 5 GB.
    # Mirrors encodeCubeFrameLengthPrefix in worker-protocol.ts.
    header = stream.read(8)
    if len(header) < 8:
        return None
    (length,) = struct.unpack("<Q", header)
    payload = stream.read(length)
    if len(payload) < length:
        return None
    return payload


def write_response_frame(payload):
    REAL_STDOUT.write(struct.pack("<I", len(payload)))
    REAL_STDOUT.write(payload)
    REAL_STDOUT.flush()


# CT-307: in-script determinate progress. Built-in scripts (and any 3-arity user
# script) receive this callable as params["report_progress"]; each accepted call
# writes a small JSON progress frame ahead of the final response. Reports are
# clamped to [0, 1] and rate-limited to 1% steps so a tight scoring loop cannot
# flood the pipe with frames.
PROGRESS_MINIMUM_STEP = 0.01
_last_reported_progress = [None]


def report_progress(fraction):
    try:
        value = float(fraction)
    except (TypeError, ValueError):
        return
    if value != value:
        return
    value = 0.0 if value < 0.0 else 1.0 if value > 1.0 else value
    last = _last_reported_progress[0]
    if last is not None and value < 1.0 and value - last < PROGRESS_MINIMUM_STEP:
        return
    _last_reported_progress[0] = value
    write_response_frame(encode_response({"type": "progress", "fraction": value}))


def reconstruct_cube_from_frame(cube_bytes, header):
    import numpy as np
    shape = tuple(header["shape"])
    return np.frombuffer(cube_bytes, dtype="<f4").reshape(shape).copy()


def build_formula_run_function(expression):
    import numpy as np
    try:
        code = compile(expression, "<formula>", "eval")
    except SyntaxError as error:
        raise RuntimeError("A formula must be a single Python expression: " + (error.msg or "invalid syntax"))

    def run(cube):
        return eval(code, {"np": np, "cube": cube})

    return run


def load_run_function_from_script(script_source):
    namespace = {"__name__": "__msi_user_script__"}
    exec(compile(script_source, "<user-script>", "exec"), namespace)
    run_function = namespace.get("run")
    if not callable(run_function):
        raise RuntimeError("The script must define a run() function.")
    return run_function


def load_run_function_from_package(package_directory):
    import importlib
    sys.path.insert(0, package_directory)
    main_module = importlib.import_module("main")
    run_function = getattr(main_module, "run", None)
    if not callable(run_function):
        raise RuntimeError("The tool's main.py must define a run() function.")
    return run_function


def load_run_function_from_builtin(directory, module_name):
    # CT-307: a packaged Stage 6 algorithm module under the app's built-in
    # script directory; loaded like a package, but by its own module name.
    import importlib
    sys.path.insert(0, directory)
    builtin_module = importlib.import_module(module_name)
    run_function = getattr(builtin_module, "run", None)
    if not callable(run_function):
        raise RuntimeError("The built-in script must define a run() function.")
    return run_function


def load_run_function(input_spec):
    kind = input_spec.get("kind") if isinstance(input_spec, dict) else None
    if kind == "formula":
        return build_formula_run_function(input_spec.get("expression", ""))
    if kind == "package":
        return load_run_function_from_package(input_spec.get("packageDirectory", ""))
    if kind == "builtin":
        return load_run_function_from_builtin(input_spec.get("directory", ""), input_spec.get("moduleName", ""))
    return load_run_function_from_script((input_spec or {}).get("scriptSource", ""))


def count_positional_parameters(run_function):
    try:
        parameters = inspect.signature(run_function).parameters.values()
    except (TypeError, ValueError):
        return 0
    kinds = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    return sum(1 for parameter in parameters if parameter.kind in kinds)


def invoke_run_function(run_function, cube, wavelengths, params):
    # CT-307: dispatch by declared positional arity so 0/1/2-arity user scripts
    # keep working; 3-or-more-arity scripts also receive the params dict.
    positional = count_positional_parameters(run_function)
    if cube is None or positional == 0:
        return run_function()
    if positional == 1:
        return run_function(cube)
    if positional == 2:
        return run_function(cube, wavelengths)
    return run_function(cube, wavelengths, params)


CUBE_RESULT_CONTRACT_MESSAGE = (
    "A cube transform must return a 3-dimensional numeric array shaped "
    "(bands, height, width) containing only finite values (no NaN or Inf)."
)


def is_numeric_array(array, np):
    return np.issubdtype(array.dtype, np.floating) or np.issubdtype(array.dtype, np.integer)


def coerce_result_to_finite_float32_cube(value):
    import numpy as np
    array = np.asarray(value)
    if array.ndim != 3 or not is_numeric_array(array, np):
        raise RuntimeError(CUBE_RESULT_CONTRACT_MESSAGE)
    # copy=False + ascontiguousarray: a result that is already contiguous
    # little-endian float32 (the common case) is sent as-is instead of being
    # copied twice; at reference scale each avoided copy is ~3 GB (CT-219g).
    cube = np.ascontiguousarray(array.astype("<f4", copy=False))
    if not np.all(np.isfinite(cube)):
        raise RuntimeError(CUBE_RESULT_CONTRACT_MESSAGE)
    return cube


# CT-219g: the raw little-endian float32 result bytes (band-major) go straight
# to the harness-provided spool file, never over stdout. A pipe delivery at
# reference scale (~3 GB) makes the reading Electron main process allocate ONE
# buffer for all available pipe bytes, which fatally exceeds its 2 GiB
# single-allocation cap. Writes are sliced so no single OS write call
# approaches the 2 GiB Windows CRT limit.
CUBE_SPOOL_WRITE_SLICE_BYTES = 256 * 1024 * 1024


def write_cube_result_to_spool(cube, spool_path):
    view = cube.data.cast("B")
    with open(spool_path, "wb") as spool:
        for start in range(0, len(view), CUBE_SPOOL_WRITE_SLICE_BYTES):
            spool.write(view[start:start + CUBE_SPOOL_WRITE_SLICE_BYTES])
    return len(view)


def encode_cube_result_frames(value, spool_path):
    if not spool_path:
        raise RuntimeError("The harness did not provide a cube result spool path.")
    cube = coerce_result_to_finite_float32_cube(value)
    spooled_byte_length = write_cube_result_to_spool(cube, spool_path)
    return [encode_response({
        "type": "completed",
        "cubeShape": list(cube.shape),
        "spooledByteLength": spooled_byte_length,
    })]


def make_json_safe(value):
    numpy = sys.modules.get("numpy")
    if numpy is None:
        return value
    if isinstance(value, numpy.ndarray):
        if not numpy.all(numpy.isfinite(value)):
            raise RuntimeError("The result contains NaN or infinite values.")
        return value.tolist()
    if isinstance(value, numpy.generic):
        return value.item()
    return value


def encode_response(message):
    return json.dumps(message, allow_nan=False).encode("utf-8")


def sandbox_user_origin_prefixes(input_spec):
    if not isinstance(input_spec, dict):
        return []
    if input_spec.get("kind") == "package":
        directory = input_spec.get("packageDirectory")
        return [directory] if directory else []
    if input_spec.get("kind") == "builtin":
        # CT-307: the sandbox must be able to read the built-in script
        # directory (lazy sibling imports after the hook installs).
        directory = input_spec.get("directory")
        return [directory] if directory else []
    return []


def encode_result_frames(request, value):
    if request.get("resultKind") == "cube":
        return encode_cube_result_frames(value, request.get("cubeResultSpoolPath"))
    return [encode_response({"type": "script-result", "value": make_json_safe(value)})]


def build_params_argument(request, masks):
    # CT-307: the effective third positional argument. The request's plain
    # params dict is copied, mask arrays (numpy uint8, never JSON) slot in
    # under "masks", and the progress callback is always available.
    raw_params = request.get("params")
    params = dict(raw_params) if isinstance(raw_params, dict) else {}
    if masks is not None:
        params["masks"] = masks
    params["report_progress"] = report_progress
    return params


def run_user_code(request, cube, masks):
    input_spec = request.get("input")
    run_function = load_run_function(input_spec)
    if request.get("sandbox"):
        install_bundled_mode_sandbox(
            sandbox_user_origin_prefixes(input_spec),
            request.get("cubeResultSpoolPath"),
        )
    wavelengths = (request.get("cube") or {}).get("wavelengths")
    value = invoke_run_function(run_function, cube, wavelengths, build_params_argument(request, masks))
    return encode_result_frames(request, value)


def handle_request(request, cube, masks):
    if not isinstance(request, dict) or request.get("type") != "run-user-script":
        return [encode_response({"type": "script-error", "message": "Malformed worker request."})]
    try:
        return run_user_code(request, cube, masks)
    except BaseException as error:
        message = str(error) or type(error).__name__
        return [encode_response({"type": "script-error", "message": message, "traceback": traceback.format_exc()})]


def read_cube_if_present(request, stream):
    header = request.get("cube") if isinstance(request, dict) else None
    if header is None:
        return None
    cube_bytes = read_cube_frame_payload(stream)
    if cube_bytes is None:
        raise RuntimeError("The cube payload frame was missing.")
    return reconstruct_cube_from_frame(cube_bytes, header)


def reconstruct_masks_from_frame(mask_bytes, header):
    import numpy as np
    count = int(header["count"])
    shape = (count, int(header["height"]), int(header["width"]))
    stacked = np.frombuffer(mask_bytes, dtype=np.uint8).reshape(shape)
    return [stacked[index].copy() for index in range(count)]


def read_masks_if_present(request, stream):
    # CT-307: one raw uint8 frame (same 8-byte length prefix as the cube frame)
    # carrying every category mask, sliced into per-category (height, width)
    # numpy arrays. Mirrors the mask payload write in python-worker.ts.
    header = request.get("masks") if isinstance(request, dict) else None
    if header is None:
        return None
    mask_bytes = read_cube_frame_payload(stream)
    if mask_bytes is None:
        raise RuntimeError("The mask payload frame was missing.")
    return reconstruct_masks_from_frame(mask_bytes, header)


# CT-334 session mode: the cube (and masks) are read ONCE at startup and kept
# as numpy arrays; each execute frame then names a built-in module, its params,
# and its result spool. Every execute goes through the same handle_request as a
# one-shot run, so progress/completed/error frames are identical - including
# re-installing the sandbox per execute, which keeps the one-shot ordering
# (module load BEFORE its sandbox install) that lets built-ins import siblings
# at module scope (CT-310). Audit hooks cannot be removed, so they accumulate
# one per sandboxed execute; each is a few set lookups per audit event, and all
# of them share _SANDBOX_HARNESS_WRITE_PATHS, so every execute's spool path
# stays writable under every earlier hook.
def build_session_execute_request(base_request, frame):
    builtin = frame.get("builtin") if isinstance(frame.get("builtin"), dict) else {}
    request = dict(base_request)
    request["input"] = {
        "kind": "builtin",
        "directory": builtin.get("directory", ""),
        "moduleName": builtin.get("moduleName", ""),
    }
    request["params"] = frame.get("params")
    request["cubeResultSpoolPath"] = frame.get("cubeResultSpoolPath")
    return request


def answer_one_session_execute(base_request, frame, cube, masks):
    if not isinstance(frame, dict) or frame.get("type") != "execute":
        write_response_frame(encode_response({"type": "script-error", "message": "Malformed session execute frame."}))
        return
    # Each execute's progress bar starts at 0: the rate limiter must not carry
    # the previous execute's last reported fraction across runs.
    _last_reported_progress[0] = None
    request = build_session_execute_request(base_request, frame)
    for frame_payload in handle_request(request, cube, masks):
        write_response_frame(frame_payload)


def run_session_loop(base_request, cube, masks):
    while True:
        payload = read_frame_payload(sys.stdin.buffer)
        if payload is None:
            return
        answer_one_session_execute(base_request, json.loads(payload.decode("utf-8")), cube, masks)


def main():
    request_payload = read_frame_payload(sys.stdin.buffer)
    if request_payload is None:
        return
    request = json.loads(request_payload.decode("utf-8"))
    try:
        cube = read_cube_if_present(request, sys.stdin.buffer)
        masks = read_masks_if_present(request, sys.stdin.buffer)
    except BaseException as error:
        write_response_frame(encode_response({"type": "script-error", "message": str(error)}))
        return
    if isinstance(request, dict) and request.get("mode") == "session":
        run_session_loop(request, cube, masks)
        return
    for frame_payload in handle_request(request, cube, masks):
        write_response_frame(frame_payload)


main()
`;
