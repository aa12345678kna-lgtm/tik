/**
 * Runtime capability detection for Ibrahim Studio.
 * This file does not load an engine and does not transmit device information.
 */
export function detectRuntimeCapabilities() {
  const nav = navigator;
  const wasm = typeof WebAssembly === "object" &&
    typeof WebAssembly.validate === "function";
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const crossOriginIsolated = window.crossOriginIsolated === true;
  const secureContext = window.isSecureContext === true;

  return Object.freeze({
    secureContext,
    wasm,
    sharedArrayBuffer,
    crossOriginIsolated,
    multiThreadReady: secureContext && wasm && sharedArrayBuffer && crossOriginIsolated,
    hardwareConcurrency: Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
    deviceMemoryGB: Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null,
    userAgent: nav.userAgent || "unknown"
  });
}

/**
 * Select multithread only when the browser supports it AND a separately-built
 * threaded FFmpeg core is actually present. Otherwise always fall back.
 */
export function selectEngineMode(capabilities, config = {}) {
  const threadedBundleAvailable = config.threadedBundleAvailable === true;
  if (
    capabilities.secureContext &&
    capabilities.wasm &&
    capabilities.multiThreadReady &&
    threadedBundleAvailable
  ) {
    return "multi-thread";
  }
  return "single-thread";
}
