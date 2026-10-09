This folder is used by Tauri Windows bundling with:

`tauri.bundle.windows.webviewInstallMode = { "type": "fixedRuntime", "path": "./webview2-runtime" }`

## What to put here

Place the **extracted Microsoft Edge WebView2 Fixed Runtime** files directly under this directory (or in its versioned subfolder, according to Microsoft package layout).

The build should be run only after this runtime is present.

## Why

`fixedRuntime` creates a larger installer but enables **offline installation** and avoids requiring internet to fetch WebView2 at install time.

## Note

Do not commit runtime binaries to git. Keep only this README tracked.
