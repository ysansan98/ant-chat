# Bundled ripgrep binaries

Download/update binaries with:

- `pnpm rg:prepare`

Place ripgrep binaries by platform/arch:

- `resources/rg/darwin-arm64/rg`
- `resources/rg/win32-x64/rg.exe`

Native tools resolve `rg` in this order:

1. `process.resourcesPath/rg/<platform>-<arch>/<binary>`
2. `<repo>/resources/rg/<platform>-<arch>/<binary>`
3. system `rg` from `PATH`
