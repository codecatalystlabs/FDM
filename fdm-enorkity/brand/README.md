# CatalystFDM brand

The CatalystFDM dragon is the Duara Mail dragon carrying a **download card** (an arrow into a tray) instead of an envelope,
in the same palette: navy `#00316b`, brand blue `#0b7fd4`, sky `#3ea2f0` (on dark), white.

| File | Use |
|------|-----|
| `logo.svg` / `logo-reverse.svg` | Full lockup (mark + CATALYST / F D M / “Downloads, built for Africa”) for light / dark backgrounds |
| `mark.svg` / `mark-reverse.svg` | The dragon alone, for light / dark backgrounds |
| `app-icon.svg` | App icon: white dragon on a navy rounded square (48 px and up) |
| `app-icon-small.svg` | Small-size variant cropped to the head and card (16–40 px: favicons, toolbar icons) |
| `wordmark.svg` / `wordmark-reverse.svg` | One-line “CatalystFDM” wordmark |
| `app-icon-1024.png` | Raster master for stores and installers |

Wordmarks are DM Sans (the Duara brand face) converted to outlines, so the SVGs render without the font installed.

## Rebuilding

`make_brand.py` reads the Duara Mail sources from `duara-mail/web/assets` and writes every SVG above:

```sh
python3 -m venv /tmp/brand-venv && /tmp/brand-venv/bin/pip install fonttools brotli
/tmp/brand-venv/bin/python make_brand.py ./
```

The PNG icon sets in `desktop/src-tauri/icons` and `extension/*/icons` were rendered from `app-icon.svg` (≥ 48 px) and
`app-icon-small.svg` (≤ 40 px) with headless Chrome at 1024 px and downscaled with Pillow (LANCZOS).
