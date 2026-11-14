"""Build static WASM assets with pinned tools. Requires Python 3.11+ and rustup."""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import sys
if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11 or newer is required; use python3 on macOS/Linux.")
import tomllib

root = Path(__file__).resolve().parent.parent
web = root / "crates" / "fallout_web"
dist = web / "dist"


def fail(message):
    raise SystemExit(message)


def run(args, **kwargs):
    try:
        return subprocess.run(args, cwd=root, check=True, **kwargs)
    except FileNotFoundError:
        fail(f"Missing executable: {args[0]}. Install it and reopen your terminal.")
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() if isinstance(error.stderr, str) else ""
        fail(f"Command failed (exit {error.returncode}): {' '.join(map(str, args))}\n{detail}")


channel = tomllib.loads((root / "rust-toolchain.toml").read_text(encoding="utf-8"))["toolchain"]["channel"]
version = json.loads((root / "tools/web-tooling.json").read_text(encoding="utf-8"))["wasm_bindgen_cli"]
lock = (root / "Cargo.lock").read_text(encoding="utf-8")
locked = [p["version"] for p in tomllib.loads(lock)["package"] if p["name"] == "wasm-bindgen"]
if locked != [version]:
    fail(f"Tool pin {version} does not match Cargo.lock wasm-bindgen versions {locked}. Review both pins together; no dependencies were updated.")
for name in ("rustup", "cargo", "rustc"):
    if not shutil.which(name):
        fail(f"Missing {name}. Install Rust using rustup: https://rust-lang.org/install")
for tool in ("rustc", "cargo"):
    actual = run([tool, "--version"], capture_output=True, text=True).stdout.strip()
    if actual.split()[1] != channel:
        fail(f"Expected {tool} {channel}; found {actual}. Run rustup toolchain install {channel}; check RUSTUP_TOOLCHAIN and directory overrides.")
targets = run(["rustup", "target", "list", "--installed"], capture_output=True, text=True).stdout.splitlines()
if "wasm32-unknown-unknown" not in targets:
    fail("Missing WASM target. Run: rustup target add wasm32-unknown-unknown")
local = root / "target/wasm-tools/bin" / ("wasm-bindgen.exe" if os.name == "nt" else "wasm-bindgen")
binding = str(local) if local.is_file() else shutil.which("wasm-bindgen")
install = f"cargo install wasm-bindgen-cli --version {version} --locked --root target/wasm-tools"
if not binding:
    fail(f"Missing wasm-bindgen {version}. Run: {install}")
actual = run([binding, "--version"], capture_output=True, text=True).stdout.strip().split()[-1]
if actual != version:
    fail(f"wasm-bindgen {version} required; found {actual} at {binding}. Run: {install}")
# The artifact location must agree with Cargo even when CARGO_TARGET_DIR is set.
metadata = json.loads(run(["cargo", "metadata", "--locked", "--no-deps", "--format-version", "1"], capture_output=True, text=True).stdout)
run(["cargo", "build", "--locked", "-p", "fallout-se-web", "--target", "wasm32-unknown-unknown", "--release"])
dist.mkdir(exist_ok=True)
run([binding, "--target", "web", "--out-dir", str(dist), "--out-name", "fallout-se-web",
     str(Path(metadata["target_directory"]) / "wasm32-unknown-unknown/release/fallout_web.wasm")])
for name in ["editor.html", "editor.js", "rpu-editor.js", "rpu-resource-declaration.example.json", "index.js"]:
    shutil.copyfile(web / name, dist / name)
index = (web / "index.html").read_text(encoding="utf-8")
index = index.replace('<base data-trunk-public-url />', '<base href="./" />')
index = re.sub(r'^.*<link data-trunk[^>]+/>\s*\n', '', index, flags=re.MULTILINE)
index = index.replace('<script data-trunk ', '<script ')
(dist / "index.html").write_text(index, encoding="utf-8")
print("Built", dist)
print(f"Serve: {sys.executable} -m http.server 8765 --bind 127.0.0.1 --directory crates/fallout_web/dist")
print("Open http://127.0.0.1:8765/editor.html")
