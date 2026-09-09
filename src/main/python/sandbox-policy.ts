// The bundled-mode sandbox policy for user scripts, shipped as a Python source string
// that the worker bootstrap installs immediately before invoking the user's run().
//
// This is an AUDIT-HOOK LEVEL guard (PEP 578 sys.addaudithook), scoped to
// trusted-with-the-user's-own-data. It is NOT a hard adversarial boundary: a
// determined attacker sharing the interpreter can still find gaps (e.g. re-using a
// capability object a bundled library already imported). Its job is to stop a buggy
// or careless script from reaching the filesystem, the network, or another process,
// and to bound its wall-clock time (in the TS harness) and address space.
//
// The three layers:
//   1. Capability denial - USE-time audit events (open, socket.connect, subprocess,
//      ctypes.dlopen, ...) are refused. This is the robust layer: it fires whenever the
//      capability is exercised, regardless of when the owning module was imported.
//   2. Import allowlist - a fresh import initiated BY USER CODE is limited to the
//      bundled stack plus a curated pure-computation stdlib subset. Best-effort:
//      Python's `import` audit event does not fire for already-cached modules, so a
//      module a bundled library already loaded can still be re-imported. Library-initiated
//      imports are always allowed so numpy/scipy/scikit-image lazy loading keeps working.
//   3. Address-space bound - resource.setrlimit(RLIMIT_AS) on POSIX; a no-op on Windows,
//      where the TS wall-clock kill remains the backstop for a runaway allocation.
//
// The allowlist / denylist / limit are defined here in TS (single source of truth,
// unit-testable without a Python runtime) and interpolated into the Python source.

export const PYTHON_SANDBOX_ALLOWED_IMPORT_ROOTS = [
  // CT-336: the app's own packaged Stage 6 algorithm modules are part of the
  // trusted bundled stack. rop_search imports its siblings (rop, npc) at module
  // scope, and in a RESIDENT SESSION a later execute loads its module while an
  // earlier execute's audit hook is still live (hooks are irremovable), so the
  // module-load-before-sandbox ordering no longer shields that sibling import.
  // Allowlisting them keeps a cross-execute sibling import working; a plain user
  // run cannot reach them anyway, since the built-in directory is only on
  // sys.path while a built-in module runs.
  "npc",
  "rop",
  "rop_search",
  "local_pca",
  "local_mnf",
  "l2_minimization",
  "numpy",
  "scipy",
  "skimage",
  "sklearn",
  "pandas",
  "matplotlib",
  "mpl_toolkits",
  "seaborn",
  "cv2",
  "PIL",
  "sympy",
  "spectral",
  "tifffile",
  "pyvips",
  "joblib",
  "requests",
  "yaml",
  "math",
  "cmath",
  "statistics",
  "fractions",
  "decimal",
  "numbers",
  "random",
  "itertools",
  "functools",
  "operator",
  "collections",
  "heapq",
  "bisect",
  "array",
  "json",
  "re",
  "string",
  "textwrap",
  "datetime",
  "time",
  "copy",
  "typing",
  "dataclasses",
  "enum",
  "warnings",
  "contextlib",
  "abc",
] as const;

export const PYTHON_SANDBOX_DENIED_AUDIT_EVENTS = [
  "socket.connect",
  "socket.bind",
  "socket.getaddrinfo",
  "subprocess.Popen",
  "os.system",
  "os.exec",
  "os.spawn",
  "os.posix_spawn",
  "os.startfile",
  "ctypes.dlopen",
  "ctypes.dlsym",
] as const;

export const PYTHON_SANDBOX_ADDRESS_SPACE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;

const ALLOWED_ROOTS_LITERAL = JSON.stringify(PYTHON_SANDBOX_ALLOWED_IMPORT_ROOTS);
const DENIED_EVENTS_LITERAL = JSON.stringify(PYTHON_SANDBOX_DENIED_AUDIT_EVENTS);

// Installed by run_user_code when the request asks for the bundled sandbox. The curated
// stack is pre-imported under no restrictions so only user-level operations are guarded,
// then the audit hook is added. Every helper is prefixed `_sandbox_` and lives under the
// bootstrap's `<string>` filename so the import-origin walk can skip our own frames.
export const PYTHON_SANDBOX_INSTALL_SOURCE = `
import os as _sandbox_os
import sys as _sandbox_sys

_SANDBOX_ALLOWED_IMPORT_ROOTS = frozenset(${ALLOWED_ROOTS_LITERAL})
_SANDBOX_DENIED_AUDIT_EVENTS = frozenset(${DENIED_EVENTS_LITERAL})
_SANDBOX_ADDRESS_SPACE_LIMIT_BYTES = ${PYTHON_SANDBOX_ADDRESS_SPACE_LIMIT_BYTES}


def _sandbox_reject(attempted_capability):
    raise PermissionError(
        "This script tried to " + attempted_capability + ", which is blocked in bundled mode. "
        "To allow it, switch to your own Python environment (an unsandboxed, trusted mode): "
        "open View > Python Environment and point the toolbox at your interpreter."
    )


# pyvips dlopens libvips and sklearn's Windows _distributor_init preloads
# vcomp140.dll via ctypes (denied audit events once the hook is live), and
# matplotlib builds and reads its font cache under the user profile (outside
# the readable prefixes), so those MUST finish loading before the hook
# installs. The rest of the curated stack loads cleanly under the hook and
# stays lazy. A broken optional package must never take down every sandboxed
# run, hence the broad excepts.
def _sandbox_preimport_curated_stack():
    for module_name in ("numpy", "scipy", "skimage", "sklearn", "pyvips"):
        try:
            __import__(module_name)
        except Exception:
            pass
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot
    except Exception:
        pass


def _sandbox_import_initiator_filename():
    frame = _sandbox_sys._getframe()
    while frame is not None:
        filename = frame.f_code.co_filename
        if "importlib" not in filename and "<frozen" not in filename and filename != "<string>":
            return filename
        frame = frame.f_back
    return None


def _sandbox_filename_belongs_to_user(filename, user_origin_prefixes):
    if filename is None:
        return False
    if filename in ("<user-script>", "<formula>"):
        return True
    return any(filename.startswith(prefix) for prefix in user_origin_prefixes)


def _sandbox_guard_import(module_name, user_origin_prefixes):
    initiator = _sandbox_import_initiator_filename()
    if not _sandbox_filename_belongs_to_user(initiator, user_origin_prefixes):
        return
    if str(module_name).split(".")[0] not in _SANDBOX_ALLOWED_IMPORT_ROOTS:
        _sandbox_reject("import '" + str(module_name) + "'")


def _sandbox_open_requests_write(mode):
    return isinstance(mode, str) and any(write_flag in mode for write_flag in "wax+")


def _sandbox_resolve_open_path(candidate):
    if not isinstance(candidate, (str, bytes)) and not hasattr(candidate, "__fspath__"):
        return None
    return _sandbox_os.path.normcase(_sandbox_os.path.abspath(_sandbox_os.fspath(candidate)))


def _sandbox_path_is_within(path, allowed_prefixes):
    return any(path == prefix or path.startswith(prefix + _sandbox_os.sep) for prefix in allowed_prefixes)


_SANDBOX_HARNESS_WRITE_PATHS = set()


def _sandbox_permit_harness_write_path(path):
    resolved = _sandbox_resolve_open_path(path)
    if resolved is not None:
        _SANDBOX_HARNESS_WRITE_PATHS.add(resolved)


def _sandbox_guard_open(args, readable_prefixes):
    resolved = _sandbox_resolve_open_path(args[0] if args else None)
    if resolved is not None and resolved in _SANDBOX_HARNESS_WRITE_PATHS:
        return
    if _sandbox_open_requests_write(args[1] if len(args) > 1 else None):
        _sandbox_reject("write to the filesystem")
    if resolved is None or not _sandbox_path_is_within(resolved, readable_prefixes):
        _sandbox_reject("read from the filesystem")


def _sandbox_readable_prefixes(user_origin_prefixes):
    runtime_prefixes = [_sandbox_sys.prefix, _sandbox_sys.base_prefix, _sandbox_sys.exec_prefix]
    roots = list(user_origin_prefixes) + runtime_prefixes
    return tuple(_sandbox_os.path.normcase(_sandbox_os.path.abspath(root)) for root in roots if root)


def _sandbox_bound_address_space():
    try:
        import resource
    except ImportError:
        return
    soft, hard = resource.getrlimit(resource.RLIMIT_AS)
    unlimited = hard == resource.RLIM_INFINITY
    ceiling = _SANDBOX_ADDRESS_SPACE_LIMIT_BYTES if unlimited else min(hard, _SANDBOX_ADDRESS_SPACE_LIMIT_BYTES)
    try:
        resource.setrlimit(resource.RLIMIT_AS, (ceiling, hard))
    except (ValueError, OSError):
        pass


def _sandbox_make_audit_hook(readable_prefixes, user_origin_prefixes):
    def _sandbox_audit_hook(event, args):
        if event in _SANDBOX_DENIED_AUDIT_EVENTS:
            _sandbox_reject("use a blocked capability (" + event + ")")
        if event == "open":
            _sandbox_guard_open(args, readable_prefixes)
        elif event == "import":
            _sandbox_guard_import(args[0], user_origin_prefixes)

    return _sandbox_audit_hook


# harness_write_path: the ONE file the worker harness itself writes (the cube
# result spool, CT-219g); user code cannot influence it, so exempting it keeps
# the "no filesystem writes" guarantee for user-level operations intact.
def install_bundled_mode_sandbox(user_origin_prefixes, harness_write_path=None):
    _sandbox_preimport_curated_stack()
    _sandbox_sys.dont_write_bytecode = True
    _sandbox_bound_address_space()
    if harness_write_path:
        _sandbox_permit_harness_write_path(harness_write_path)
    normalized = tuple(_sandbox_os.path.abspath(prefix) for prefix in user_origin_prefixes if prefix)
    readable_prefixes = _sandbox_readable_prefixes(user_origin_prefixes)
    _sandbox_sys.addaudithook(_sandbox_make_audit_hook(readable_prefixes, normalized))
`;
