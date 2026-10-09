/**
 * Builds the Go backend and places it where Tauri `externalBin` expects:
 * desktop/src-tauri/binaries/fdm-enorkity-server-<rustc-host-triple>(.exe)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");
const goBackend = path.join(workspaceRoot, "go-backend");
const outDir = path.resolve(__dirname, "..", "src-tauri", "binaries");

function sleepMs(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // busy-wait for short startup stabilization windows
  }
}

function waitUntilReadable(filePath, timeoutMs = 15000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile() || st.size <= 0) {
        lastErr = new Error("sidecar binary is empty or not a regular file");
        sleepMs(150);
        continue;
      }
      const fd = fs.openSync(filePath, "r");
      fs.closeSync(fd);
      return;
    } catch (err) {
      lastErr = err;
      sleepMs(150);
    }
  }
  throw new Error(
    `sidecar output remained unavailable after ${timeoutMs}ms: ${lastErr ? String(lastErr.message || lastErr) : "unknown error"}`,
  );
}

function rustcHostTriple() {
  const rustc = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (rustc.status !== 0 || !rustc.stdout) return null;
  const m = rustc.stdout.match(/^host:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

/** Best-effort when rustc is not on PATH (CI should still set FDM_SIDECAR_HOST_TRIPLE). */
function goEnvFallbackTriple() {
  const goos = spawnSync("go", ["env", "GOOS"], { encoding: "utf8" }).stdout?.trim();
  const goarch = spawnSync("go", ["env", "GOARCH"], { encoding: "utf8" }).stdout?.trim();
  if (!goos || !goarch) return null;
  if (goos === "windows" && goarch === "amd64") return "x86_64-pc-windows-msvc";
  if (goos === "windows" && goarch === "arm64") return "aarch64-pc-windows-msvc";
  if (goos === "darwin" && goarch === "amd64") return "x86_64-apple-darwin";
  if (goos === "darwin" && goarch === "arm64") return "aarch64-apple-darwin";
  if (goos === "linux" && goarch === "amd64") return "x86_64-unknown-linux-gnu";
  if (goos === "linux" && goarch === "arm64") return "aarch64-unknown-linux-gnu";
  return null;
}

/**
 * Last-resort: match Tauri's expected sidecar filename when neither rustc nor go are available.
 * Assumes MSVC on Windows (default for rustup); set FDM_SIDECAR_HOST_TRIPLE if you use the GNU toolchain.
 */
function nodePlatformTriple() {
  const { platform, arch } = process;
  if (platform === "win32") {
    if (arch === "x64") return "x86_64-pc-windows-msvc";
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
  }
  if (platform === "darwin") {
    if (arch === "x64") return "x86_64-apple-darwin";
    if (arch === "arm64") return "aarch64-apple-darwin";
  }
  if (platform === "linux") {
    if (arch === "x64") return "x86_64-unknown-linux-gnu";
    if (arch === "arm64") return "aarch64-unknown-linux-gnu";
  }
  return null;
}

function resolveTriple() {
  const fromEnv = process.env.FDM_SIDECAR_HOST_TRIPLE?.trim();
  if (fromEnv) return { triple: fromEnv, source: "FDM_SIDECAR_HOST_TRIPLE" };
  const fromRustc = rustcHostTriple();
  if (fromRustc) return { triple: fromRustc, source: "rustc host" };
  const fromGo = goEnvFallbackTriple();
  if (fromGo) return { triple: fromGo, source: "go env" };
  const fromNode = nodePlatformTriple();
  if (fromNode) return { triple: fromNode, source: "Node process.platform/arch (fallback)" };
  return null;
}

const resolved = resolveTriple();
if (!resolved) {
  console.error(
    [
      "Cannot resolve Rust-style target triple for the sidecar filename.",
      "",
      "Fix one of:",
      "  • Set FDM_SIDECAR_HOST_TRIPLE (e.g. x86_64-pc-windows-msvc)",
      "  • Install Rust and add rustc to PATH https://rustup.rs/",
      "  • Install Go and add go to PATH",
      "",
      "Note: npm run build:go-sidecar only builds the Go binary. tauri dev / tauri build still require Rust (cargo).",
    ].join("\n"),
  );
  process.exit(1);
}

if (resolved.source !== "rustc host") {
  console.warn(`[build-go-sidecar] Using triple from ${resolved.source}: ${resolved.triple}`);
}
const triple = resolved.triple;

fs.mkdirSync(outDir, { recursive: true });
const exe = triple.includes("windows") ? ".exe" : "";
const outfile = path.join(outDir, `fdm-enorkity-server-${triple}${exe}`);
console.info(`Building Go backend for ${triple}\n→ ${outfile}`);
const args = ["build", "-trimpath", "-ldflags=-s -w", "-o", outfile, "./cmd/server"];
const go = spawnSync("go", args, {
  cwd: goBackend,
  stdio: "inherit",
});
if (go.status !== 0) {
  console.error("go build failed.");
  process.exit(go.status ?? 1);
}

try {
  waitUntilReadable(outfile);
} catch (err) {
  console.error(`[build-go-sidecar] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
