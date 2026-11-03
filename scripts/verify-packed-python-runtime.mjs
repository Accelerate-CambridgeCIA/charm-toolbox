// Verifies that a packed app directory actually contains the bundled Python
// runtime (CT-262). electron-builder treats a missing extraResources source as
// a WARNING only (fileMatcher: "file source doesn't exist") and still produces
// a complete installer, so a build machine without .python/ ships an app whose
// custom functions all fail with PythonInterpreterNotFoundError. This check
// turns that silent gap into a build failure.
// Used by scripts/after-pack.mjs (electron-builder afterPack hook) and runnable
// standalone: node scripts/verify-packed-python-runtime.mjs <appOutDir>
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function packedResourcesDirectory(appOutDir, electronPlatformName, productFilename) {
  if (electronPlatformName === "darwin") {
    return join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return join(appOutDir, "resources");
}

function interpreterRelativePath(electronPlatformName) {
  return electronPlatformName === "win32" ? "python.exe" : join("bin", "python3");
}

function sitePackagesDirectoryOrNull(runtimeDirectory, electronPlatformName) {
  if (electronPlatformName === "win32") return join(runtimeDirectory, "Lib", "site-packages");
  const libDirectory = join(runtimeDirectory, "lib");
  if (!existsSync(libDirectory)) return null;
  const versionedDirectoryName = readdirSync(libDirectory).find((name) => /^python3\.\d+$/.test(name));
  if (versionedDirectoryName === undefined) return null;
  return join(libDirectory, versionedDirectoryName, "site-packages");
}

// numpy stands in for the whole curated package set: its absence catches a
// runtime that was extracted but never had its packages installed.
function listMissingCuratedPackageMarkers(runtimeDirectory, electronPlatformName) {
  const sitePackagesDirectory = sitePackagesDirectoryOrNull(runtimeDirectory, electronPlatformName);
  if (sitePackagesDirectory === null) return [join(runtimeDirectory, "<site-packages>")];
  const numpyDirectory = join(sitePackagesDirectory, "numpy");
  return existsSync(numpyDirectory) ? [] : [numpyDirectory];
}

export function listMissingPackedPythonRuntimePaths({ appOutDir, electronPlatformName, productFilename }) {
  const runtimeDirectory = join(
    packedResourcesDirectory(appOutDir, electronPlatformName, productFilename),
    "python",
  );
  if (!existsSync(runtimeDirectory)) return [runtimeDirectory];
  const interpreterPath = join(runtimeDirectory, interpreterRelativePath(electronPlatformName));
  const missingPaths = existsSync(interpreterPath) ? [] : [interpreterPath];
  return [...missingPaths, ...listMissingCuratedPackageMarkers(runtimeDirectory, electronPlatformName)];
}

export function assertPackedAppContainsPythonRuntime(packedAppDescription) {
  const missingPaths = listMissingPackedPythonRuntimePaths(packedAppDescription);
  if (missingPaths.length === 0) {
    console.log(`Bundled Python runtime verified in ${packedAppDescription.appOutDir}`);
    return;
  }
  throw new Error(
    `The packed app at ${packedAppDescription.appOutDir} is missing the bundled Python runtime ` +
      `(missing: ${missingPaths.join(", ")}). Run "node scripts/setup-python-runtime.mjs" before ` +
      `packaging; electron-builder only WARNS when the extraResources source .python/ is absent.`,
  );
}

function electronPlatformNameForThisMachine() {
  return process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
}

function runCommandLineVerification() {
  const appOutDir = process.argv[2];
  if (appOutDir === undefined) {
    throw new Error("Usage: node scripts/verify-packed-python-runtime.mjs <appOutDir>");
  }
  assertPackedAppContainsPythonRuntime({
    appOutDir: resolve(appOutDir),
    electronPlatformName: electronPlatformNameForThisMachine(),
    productFilename: "MSI Toolbox",
  });
}

const isRunDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isRunDirectly) runCommandLineVerification();
