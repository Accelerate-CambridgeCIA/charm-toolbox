// Installs the bundled Python runtime for development into repo-local .python/.
// Downloads a pinned python-build-standalone CPython release (tag + SHA256 verified),
// extracts it, and installs the curated scientific stack pinned in
// scripts/python-runtime-packages.json (the single source of truth also enforced
// by the docs and worker tests).
// Packaged builds ship this same directory via electron-builder extraResources.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_INSTALL_DIR = resolve(PROJECT_ROOT, ".python");
const RUNTIME_PACKAGES_MANIFEST_PATH = resolve(PROJECT_ROOT, "scripts", "python-runtime-packages.json");

const PINNED_RELEASE_TAG = "20260623";
const PINNED_CPYTHON_VERSION = "3.12.13";

function pinnedCuratedPackageSpecifiers() {
  const manifest = JSON.parse(readFileSync(RUNTIME_PACKAGES_MANIFEST_PATH, "utf-8"));
  return manifest.packages.map((entry) => {
    const extras = entry.pipExtras ? `[${entry.pipExtras}]` : "";
    return `${entry.distribution}${extras}==${entry.version}`;
  });
}

const PINNED_RUNTIME_DOWNLOADS = {
  "win32-x64": {
    target: "x86_64-pc-windows-msvc",
    sha256: "c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e",
  },
  "darwin-x64": {
    target: "x86_64-apple-darwin",
    sha256: "7c57fdd1fa675190093700eb0d8e7117e1f9eae7c30a46dea5f8d5266bcfc791",
  },
  "darwin-arm64": {
    target: "aarch64-apple-darwin",
    sha256: "3724aa4dafb5f7b6c2cf98e89914e4248dc6bd2fe40407df4a2d73de99615f16",
  },
  "linux-x64": {
    target: "x86_64-unknown-linux-gnu",
    sha256: "9fa869d69be54f6b8eeae64272fbd9bb0646e0e1a8da9d80e51ba5a3bee48930",
  },
};

function pinnedDownloadForThisMachineOrThrow() {
  const machineKey = `${process.platform}-${process.arch}`;
  const download = PINNED_RUNTIME_DOWNLOADS[machineKey];
  if (download === undefined) {
    throw new Error(`No pinned Python runtime for ${machineKey}.`);
  }
  return download;
}

function releaseArchiveUrlForTarget(target) {
  const fileName = `cpython-${PINNED_CPYTHON_VERSION}+${PINNED_RELEASE_TAG}-${target}-install_only.tar.gz`;
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${PINNED_RELEASE_TAG}/${fileName}`;
}

async function downloadReleaseArchiveAsBuffer(url) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function assertArchiveChecksumMatchesPin(archiveBuffer, expectedSha256) {
  const actualSha256 = createHash("sha256").update(archiveBuffer).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  console.log("SHA256 checksum verified.");
}

function tarExecutablePath() {
  // On Windows, PATH may resolve to MSYS GNU tar, which misreads C:\ paths as
  // remote hosts; the system bsdtar handles them natively.
  if (process.platform === "win32") return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return "tar";
}

async function extractArchiveIntoInstallDir(archiveBuffer) {
  const archivePath = join(tmpdir(), `msi-toolbox-python-${PINNED_RELEASE_TAG}.tar.gz`);
  await writeFile(archivePath, archiveBuffer);
  await rm(RUNTIME_INSTALL_DIR, { recursive: true, force: true });
  await mkdir(RUNTIME_INSTALL_DIR, { recursive: true });
  execFileSync(tarExecutablePath(), ["-xzf", archivePath, "-C", RUNTIME_INSTALL_DIR, "--strip-components=1"], {
    stdio: "inherit",
  });
  await rm(archivePath, { force: true });
}

function bundledInterpreterPath() {
  if (process.platform === "win32") return join(RUNTIME_INSTALL_DIR, "python.exe");
  return join(RUNTIME_INSTALL_DIR, "bin", "python3");
}

function installCuratedPackagesIntoRuntime(interpreterPath) {
  const specifiers = pinnedCuratedPackageSpecifiers();
  console.log(`Installing curated packages: ${specifiers.join(", ")}`);
  execFileSync(interpreterPath, ["-m", "pip", "install", "--no-input", ...specifiers], {
    stdio: "inherit",
  });
}

async function downloadVerifyAndExtractPinnedRuntime() {
  const download = pinnedDownloadForThisMachineOrThrow();
  const archiveBuffer = await downloadReleaseArchiveAsBuffer(releaseArchiveUrlForTarget(download.target));
  assertArchiveChecksumMatchesPin(archiveBuffer, download.sha256);
  await extractArchiveIntoInstallDir(archiveBuffer);
}

async function setUpBundledPythonRuntime() {
  const forceReinstall = process.argv.includes("--force");
  if (forceReinstall || !existsSync(bundledInterpreterPath())) {
    await downloadVerifyAndExtractPinnedRuntime();
  } else {
    console.log(`Runtime already present at ${RUNTIME_INSTALL_DIR} (pass --force to reinstall).`);
  }
  installCuratedPackagesIntoRuntime(bundledInterpreterPath());
  console.log(`Bundled Python runtime ready: ${bundledInterpreterPath()}`);
}

await setUpBundledPythonRuntime();
