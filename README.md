# Ibrahim Studio

Arabic-first browser video preparation studio. Video processing is intended to remain on the user's device.

## Hosting

Recommended: Cloudflare Pages, deploying the repository root. The `_headers` file configures:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

A matching `vercel.json` is included as an alternative.

These headers enable cross-origin isolation only when all loaded resources satisfy the browser's CORS/CORP requirements. Verify in the deployed browser using `window.crossOriginIsolated` and `typeof SharedArrayBuffer`.

## Free project

Ibrahim Studio is intended to be free to use. No activation code, subscription, account or trial counter is part of the product.

## Engine strategy

- Existing studio engine remains single-threaded.
- `assets/js/runtime-capabilities.js` detects browser capabilities.
- `assets/js/engine-loader.js` selects a mode, but intentionally keeps the multi-thread bundle disabled until a matching threaded FFmpeg core and worker files are checked in and tested.
- SharedArrayBuffer support alone does not turn a single-thread core into a multi-thread core.

## Pages

- `/studio/` — existing studio entry point (current root page retained).
- `/docs/` — user guide.
- `/tiktok/` — upload instructions.
- `/support/` — local browser diagnostics.

## Local privacy

The project is free and has no accounts, activation codes, subscriptions or free-trial counters. The browser diagnostic runs locally. No video upload or cloud HandBrake processing is implemented by these files.
