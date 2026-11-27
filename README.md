# Ibrahim Studio

Arabic-first browser video preparation studio. Video processing is intended to remain on the user's device.

## Hosting

Recommended: Cloudflare Pages, deploying the repository root. The `_headers` file configures:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

A matching `vercel.json` is included as an alternative.

These headers enable cross-origin isolation only when all loaded resources satisfy the browser's CORS/CORP requirements. Verify in the deployed browser using `window.crossOriginIsolated` and `typeof SharedArrayBuffer`.

## Free project


## Engine strategy

- The studio selects `@ffmpeg/core-mt@0.12.6` when HTTPS, WebAssembly, SharedArrayBuffer and cross-origin isolation are available.
- The multi-thread core and its pthread worker are loaded from jsDelivr; the wrapper uses `@ffmpeg/ffmpeg@0.12.10`.
- If the multi-thread core fails to load, the studio automatically falls back to `@ffmpeg/core@0.12.6` (single-thread).
- SharedArrayBuffer support alone does not turn a single-thread core into a multi-thread core; the matching core and worker are both required.
- First load of the multi-thread core downloads a large WASM file (about 33 MB) and requires an internet connection.

## Pages

- `/studio/` — existing studio entry point (current root page retained).
- `/docs/` — user guide.
- `/tiktok/` — upload instructions.
- `/support/` — local browser diagnostics.

## Local privacy

