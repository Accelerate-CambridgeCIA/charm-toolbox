# Releasing MSI Toolbox

This document is for maintainers. End-user installation instructions live in [README.md](README.md).

## Cutting a release

Releases are produced by the `Release` GitHub Actions workflow at `.github/workflows/release.yml`, which builds the Windows installer, the two macOS dmgs and the Linux deb in parallel and uploads them to a GitHub Release named after the tag.

To cut a release, push a semver tag matching `v*.*.*` from the branch you want to release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow can also be triggered manually from the Actions tab via **Run workflow** (no tag needed). Manual runs build and store the installers as workflow artifacts but do not create a GitHub Release; tag pushes are the only path to a published Release.

## Local builds

For development verification on your own machine:

- Windows: `pnpm build:win` produces an unsigned NSIS installer under `dist/`.
- macOS: `pnpm build:mac` produces unsigned x64 and arm64 dmgs under `dist/`.
- Linux: `pnpm build:linux` produces an x64 `.deb` under `dist/` (install with `sudo apt install ./dist/charm-toolbox_<version>_amd64.deb`).

Cross-platform builds without the matching native packaging tools (`hdiutil` for dmg, `signtool` for Windows signing) are not supported and will fail. The CI workflow handles each platform on its native runner.
