// CT-334: a Python worker that loads the cube once and answers many execute
// requests. Spawn streams the session request plus the cube (and mask) frames
// into the bootstrap's session mode and KEEPS STDIN OPEN; each execute then
// costs only a small JSON frame instead of an interpreter start and a full
// cube read. One execute may be in flight at a time (the ROP session is
// strictly sequential); timeoutMs applies per execute and, because the timer
// starts when execute() is called while the worker may still be loading the
// cube, the spawn-and-load time counts against the first execute only.
// Progress frames restart the timer exactly like the one-shot observer
// (CT-310: the wall clock measures silence, not total run time).
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { EncodedCubePayload, EncodedMaskPayload } from "./cube-payload";
import {
  buildWorkerCanceledOutcome,
  buildWorkerCrashedOutcome,
  buildWorkerTimeoutOutcome,
  outcomeFromWorkerResponse,
  spawnPythonWorkerProcess,
  writeToStreamAwaitingFlush,
  writeWorkerRequestAndPayloadFrames,
  type PythonWorkerOutcome,
} from "./python-worker";
import {
  encodeSessionExecuteFrame,
  WorkerResponseFrameDecoder,
  type JsonValue,
  type PythonWorkerResponse,
  type RunUserScriptRequest,
  type UserScriptInput,
  type UserScriptResultKind,
} from "./worker-protocol";

export interface ResidentPythonWorkerSpawnRequest {
  interpreterPath: string;
  // The session's opening input; execute frames name their own builtin module,
  // so this only describes the session to the worker (and stays typed for the
  // callers that already hold a builtin UserScriptInput).
  input: UserScriptInput;
  cube: EncodedCubePayload | null;
  masks?: EncodedMaskPayload | null;
  resultKind: UserScriptResultKind;
  sandbox: boolean;
  // Per-execute silence budget (restarted by progress frames, CT-310).
  timeoutMs: number;
}

export interface ResidentExecuteBuiltin {
  directory: string;
  moduleName: string;
}

export interface ResidentExecuteCallbacks {
  onProgress?: (fraction: number) => void;
}

export interface ResidentPythonWorker {
  execute(
    params: JsonValue | null,
    builtin: ResidentExecuteBuiltin,
    cubeResultSpoolPath: string | null,
    callbacks?: ResidentExecuteCallbacks,
  ): Promise<PythonWorkerOutcome>;
  kill(): void;
  isAlive(): boolean;
}

const STDERR_DETAIL_LIMIT_BYTES = 8192;

export function spawnResidentPythonWorker(
  request: ResidentPythonWorkerSpawnRequest,
): ResidentPythonWorker {
  return new ResidentPythonWorkerProcess(spawnPythonWorkerProcess(request.interpreterPath), request);
}

function buildSessionOpeningRequest(request: ResidentPythonWorkerSpawnRequest): RunUserScriptRequest {
  return {
    type: "run-user-script",
    mode: "session",
    input: request.input,
    cube: request.cube?.header ?? null,
    masks: request.masks?.header ?? null,
    params: null,
    resultKind: request.resultKind,
    cubeResultSpoolPath: null,
    sandbox: request.sandbox,
  };
}

interface InFlightExecute {
  readonly cubeResultSpoolPath: string | null;
  readonly onProgress?: (fraction: number) => void;
  timeoutTimer: NodeJS.Timeout | undefined;
  resolveWithOutcome: (outcome: PythonWorkerOutcome) => void;
}

class ResidentPythonWorkerProcess implements ResidentPythonWorker {
  private readonly responseDecoder = new WorkerResponseFrameDecoder();
  private readonly stderrChunks: Buffer[] = [];
  private readonly perExecuteTimeoutMs: number;
  private inFlight: InFlightExecute | null = null;
  private hasProcessEnded = false;
  // Serializes every stdin write: execute frames must never interleave with
  // the opening request/cube/mask frames still streaming out.
  private stdinWriteChain: Promise<void>;

  constructor(
    private readonly worker: ChildProcessWithoutNullStreams,
    request: ResidentPythonWorkerSpawnRequest,
  ) {
    this.perExecuteTimeoutMs = request.timeoutMs;
    this.beginObservingWorkerStreams();
    this.stdinWriteChain = this.streamSessionOpeningFrames(request);
  }

  execute(
    params: JsonValue | null,
    builtin: ResidentExecuteBuiltin,
    cubeResultSpoolPath: string | null,
    callbacks?: ResidentExecuteCallbacks,
  ): Promise<PythonWorkerOutcome> {
    if (this.inFlight !== null) {
      throw new Error("A resident worker execute is already in flight");
    }
    if (!this.isAlive()) {
      return Promise.resolve(buildWorkerCrashedOutcome(this.collectedStderrText()));
    }
    return this.beginTrackedExecute(params, builtin, cubeResultSpoolPath, callbacks);
  }

  kill(): void {
    this.settleInFlightExecute(buildWorkerCanceledOutcome());
    this.killWorkerProcess();
  }

  isAlive(): boolean {
    return !this.hasProcessEnded && this.worker.exitCode === null && !this.worker.killed;
  }

  private beginTrackedExecute(
    params: JsonValue | null,
    builtin: ResidentExecuteBuiltin,
    cubeResultSpoolPath: string | null,
    callbacks?: ResidentExecuteCallbacks,
  ): Promise<PythonWorkerOutcome> {
    return new Promise((resolveWithOutcome) => {
      this.inFlight = {
        cubeResultSpoolPath,
        onProgress: callbacks?.onProgress,
        timeoutTimer: undefined,
        resolveWithOutcome,
      };
      this.queueExecuteFrameWrite(params, builtin, cubeResultSpoolPath);
      this.restartExecuteTimeout();
    });
  }

  private queueExecuteFrameWrite(
    params: JsonValue | null,
    builtin: ResidentExecuteBuiltin,
    cubeResultSpoolPath: string | null,
  ): void {
    const frame = encodeSessionExecuteFrame({ type: "execute", params, cubeResultSpoolPath, builtin });
    this.stdinWriteChain = this.stdinWriteChain.then(() =>
      writeToStreamAwaitingFlush(this.worker.stdin, frame),
    );
  }

  private async streamSessionOpeningFrames(request: ResidentPythonWorkerSpawnRequest): Promise<void> {
    this.worker.stdin.on("error", () => undefined);
    try {
      await writeWorkerRequestAndPayloadFrames(
        this.worker.stdin,
        buildSessionOpeningRequest(request),
        request.cube,
        request.masks ?? null,
      );
    } catch {
      this.worker.stdin.destroy();
    }
  }

  private beginObservingWorkerStreams(): void {
    this.worker.stdout.on("data", (chunk: Buffer) => this.handleStdoutChunk(chunk));
    this.worker.stderr.on("data", (chunk: Buffer) => this.collectStderrChunk(chunk));
    this.worker.on("error", (error) => this.handleWorkerEnded(error.message));
    // "close" (not "exit") so buffered stdout data events flush first.
    this.worker.on("close", () => this.handleWorkerEnded(this.collectedStderrText()));
  }

  private handleStdoutChunk(chunk: Buffer): void {
    try {
      const responses = this.responseDecoder.appendChunkAndTakeCompletedResponses(chunk);
      for (const response of responses) this.routeWorkerResponse(response);
    } catch (decodeError) {
      this.failBecauseProtocolBroke(decodeError);
    }
  }

  // A malformed frame means the framing itself is unrecoverable: settle the
  // in-flight execute as crashed and kill the process so isAlive() turns false.
  private failBecauseProtocolBroke(decodeError: unknown): void {
    const detail = decodeError instanceof Error ? decodeError.message : String(decodeError);
    this.settleInFlightExecute(buildWorkerCrashedOutcome(detail));
    this.killWorkerProcess();
  }

  private routeWorkerResponse(response: PythonWorkerResponse): void {
    const run = this.inFlight;
    if (run === null) return;
    if (response.type === "progress") {
      run.onProgress?.(response.fraction);
      this.restartExecuteTimeout();
      return;
    }
    this.settleInFlightExecute(outcomeFromWorkerResponse(response, run.cubeResultSpoolPath));
  }

  private restartExecuteTimeout(): void {
    const run = this.inFlight;
    if (run === null) return;
    if (run.timeoutTimer !== undefined) clearTimeout(run.timeoutTimer);
    run.timeoutTimer = setTimeout(() => this.failInFlightOnWallClockTimeout(), this.perExecuteTimeoutMs);
  }

  // A silent worker is wedged; the session cannot trust it for later executes,
  // so a timeout kills the process (the owner respawns from the retained spool).
  private failInFlightOnWallClockTimeout(): void {
    this.settleInFlightExecute(buildWorkerTimeoutOutcome(this.perExecuteTimeoutMs));
    this.killWorkerProcess();
  }

  private handleWorkerEnded(detail: string | undefined): void {
    this.hasProcessEnded = true;
    this.settleInFlightExecute(buildWorkerCrashedOutcome(detail || undefined));
  }

  private settleInFlightExecute(outcome: PythonWorkerOutcome): void {
    const run = this.inFlight;
    if (run === null) return;
    this.inFlight = null;
    if (run.timeoutTimer !== undefined) clearTimeout(run.timeoutTimer);
    run.resolveWithOutcome(outcome);
  }

  private collectStderrChunk(chunk: Buffer): void {
    if (this.collectedStderrLength() < STDERR_DETAIL_LIMIT_BYTES) this.stderrChunks.push(chunk);
  }

  private collectedStderrLength(): number {
    return this.stderrChunks.reduce((total, next) => total + next.length, 0);
  }

  private collectedStderrText(): string | undefined {
    return Buffer.concat(this.stderrChunks).toString("utf8").trim() || undefined;
  }

  private killWorkerProcess(): void {
    if (this.worker.exitCode === null && !this.worker.killed) this.worker.kill("SIGKILL");
  }
}
