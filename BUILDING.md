# Reproducible browser build and validation

Supported development targets are Windows 11 x64, macOS Apple Silicon, macOS Intel,
and Linux x64. Phase 6 was executed locally on Windows only. The CI matrix targets
all four; a workflow definition is not evidence that a platform has passed.

## Prerequisites

- Git and rustup. `rust-toolchain.toml` pins Rust 1.100.0, rustfmt, and
  `wasm32-unknown-unknown`; running Cargo in this checkout installs/selects them.
- Windows: Visual Studio Build Tools, Desktop development with C++, and Windows SDK.
- macOS: native terminal and Command Line Tools (`xcode-select --install`). Use
  `aarch64-apple-darwin` on Apple Silicon and `x86_64-apple-darwin` on Intel;
  check `rustc -vV` to avoid accidental Rosetta builds.
- Linux: a C compiler/linker (for Debian/Ubuntu: `sudo apt-get install build-essential git curl python3`).
- Python 3.11+ (validated and pinned in CI: 3.12.10).
- Node 22+ for tests (validated and pinned in CI: 26.13.1), with npm.
- A desktop browser supporting WebAssembly, ES modules, folder upload
  (`webkitdirectory`), and Blob downloads. Automated coverage currently targets
  Chromium only; Safari and Firefox compatibility is unverified.

Install Rust using https://rust-lang.org/install. Initial dependency/tool/browser
installation needs network access. No game assets are needed to build or smoke test.
There is no npm step for the application itself. Trunk is optional and is not used
by the reproducible build or Pages workflow.

## Windows PowerShell

From a new checkout or this repository root:

```powershell
rustup show
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.108 --locked --root target/wasm-tools
cargo test --workspace --locked
cargo fmt --all -- --check
git diff --check
node --test crates/fallout_web/rpu-editor.test.mjs
python tools/build_web.py
node tools/browser/verify-dist.mjs
python -m http.server 8765 --bind 127.0.0.1 --directory crates/fallout_web/dist
```

Open http://127.0.0.1:8765/editor.html. Keep the server terminal open; stop it with
Ctrl+C. Use `npm.cmd`/`npx.cmd` below if PowerShell blocks npm's script shims.

## macOS Apple Silicon, macOS Intel, and Linux

From the repository root, use the same commands with `python3`:

```sh
rustup show
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.108 --locked --root target/wasm-tools
cargo test --workspace --locked
cargo fmt --all -- --check
git diff --check
node --test crates/fallout_web/rpu-editor.test.mjs
python3 tools/build_web.py
node tools/browser/verify-dist.mjs
python3 -m http.server 8765 --bind 127.0.0.1 --directory crates/fallout_web/dist
```

Open http://127.0.0.1:8765/editor.html. The build checks Rust/Cargo versions,
installed target, and the binding generator against `tools/web-tooling.json` and
Cargo.lock. It uses the Cargo metadata target directory, including
`CARGO_TARGET_DIR`, and does not upgrade dependencies. Generated assets are in
`crates/fallout_web/dist`; `target/wasm-tools` holds the host-specific generator.
`verify-dist.mjs` checks required nonempty assets, relative URLs, processed HTML,
and initializes the generated WASM bindings without a browser.

Pins make dependency selection repeatable; bit-for-bit output across different
host platforms and reproducibility of downloaded tool binaries are not guaranteed.

## Browser smoke regression (no proprietary resources)

```sh
npm ci --prefix tools/browser --ignore-scripts
cd tools/browser
npx --no-install playwright install --with-deps chromium
cd ../..
node tools/browser/smoke.mjs
```

The package lock pins Playwright 1.65.1 and its browser revision. Linux browser
system dependencies may require administrator access. The smoke test starts its
own asset-only loopback server on an ephemeral port and closes it and Chromium.
It checks both page startups, real WASM initialization, RPU controls, rejected
inspection without consent/resources, malformed-save handling, export disabling,
legacy control restoration, page/console errors and failed asset requests.
All malformed bytes are generated in memory; no saves or archives are used.

For an existing compatible Chromium browser, set `CHROME_PATH` to its executable
before running the smoke test. This override is useful locally but does not pin
the browser version; CI installs the Playwright browser instead.

PowerShell example:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tools/browser/smoke.mjs
Remove-Item Env:CHROME_PATH
```

## Explicit real-resource integration tests

`tools/browser/rpu-real-resource.cjs` is a separate opt-in adaptation of the
previous local harness. It requires the known baseline complete slot (SAVE.DAT
SHA-256 `d8e064a74970736939d3ec1fad31b5df13c7b139eac127a2b16f5313d2bf91e0`)
and archives matching the resource declaration. It is not a generic-save test and
is never run by standard CI. No assets are bundled. Start the local server first.

```sh
FALLOUT_RPU_REAL_TEST=1 node tools/browser/rpu-real-resource.cjs http://127.0.0.1:8765/editor.html /path/to/copied-slot /path/to/rpu.dat /path/to/master.dat
```

PowerShell:

```powershell
$env:FALLOUT_RPU_REAL_TEST = '1'
node tools/browser/rpu-real-resource.cjs http://127.0.0.1:8765/editor.html C:/copied-slot C:/resources/rpu.dat C:/resources/master.dat
Remove-Item Env:FALLOUT_RPU_REAL_TEST
```

An optional final argument selects an existing Chrome executable. Downloads,
screenshot and JSON evidence go to a newly created temporary directory printed by
the test. It does not overwrite repository logs or install output into a game.
The original untracked `tools/rpu-browser-e2e.cjs` is preserved and is not required.

Three Windows-only local layout tests are now explicitly ignored. To run them:

```powershell
$env:FALLOUT_LAYOUT_FIXTURE_DIR = 'C:/path/to/private-layout-fixtures'
cargo test -p fallout-se --test local_layout_regression -- --ignored --nocapture
```

They require OLD.DAT, RPU.DAT, RPU-TEST.DAT with their existing asserted hashes,
and Windows certutil. Missing configuration/files fail when explicitly selected.
Other installed-resource/forensic tests remain ignored and retain their documented
local assumptions. Do not run all ignored tests indiscriminately. Standard CI
uses repository fixtures and synthetic resources, never installed game archives.

## Safe RPU workflow and boundaries

See [the RPU guide](rpu-browser-mvp.md) for the complete workflow. Select a copied,
complete save-slot folder; rpu.dat; master.dat; and a trusted resource declaration.
The modeled order is RPU before base, plus saved item overlays. Expected hashes
must come from a trusted source, not be changed merely to silence rejection.
Matching hashes do not authenticate runtime precedence, extra mods or provenance.

Inspect, select an exact inventory row, enter an integer 1..2147483647, verify,
and download both the edited SAVE.DAT and verification receipt to a separate
location. Each edit starts from the original uploaded snapshot. Export verifies
fresh structural parsing and byte isolation to the chosen four-byte quantity.
Browser download dialogs cannot guarantee no-overwrite or live-slot protection.
Preserve the original complete slot and all companions. Later game testing must
use an isolated complete slot with matching companions, never just a lone export.

Unsupported: add/remove/equip/PID edits, zero quantity, batch editing, nonempty
virtual sfall filesystem, unresolved required metadata, ambiguous/colliding paths,
missing companions/maps, undeclared resource combinations, and automatic slot
installation. Companion presence is checked; their complete semantics are not
simulated. Large archive copies need substantial desktop memory and synchronous
WASM work may stall the page. Native experimental filesystem export remains
Windows-only; browser downloads have separate guarantees. No serializer fallback
is used for rejected RPU saves.

## CI and release evidence

`.github/workflows/validate.yml` targets windows-2022 (x64), ubuntu-24.04 (x64),
macos-15 (ARM64), and macos-15-intel (x64), with an architecture assertion.
Runner availability depends on GitHub/repository access; missing runners must not
be reported as successful platform validation. All matrix entries run Rust tests,
formatting, JS tests, release build, distribution verification and Chromium smoke.
The Pages workflow uses the same direct builder with relative asset URLs.
Actions use major-version tags; full action SHA pinning and cross-host binary
identity remain possible follow-up hardening. No workflow includes private game assets.
