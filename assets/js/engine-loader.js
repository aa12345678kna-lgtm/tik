/**
 * Capability-gated FFmpeg engine selection.
 * Multi-thread is selected only when browser isolation, SharedArrayBuffer,
 * WebAssembly and the matching core-mt CDN bundle are available.
 * The studio retains a single-thread fallback if threaded loading fails.
 */
import { detectRuntimeCapabilities, selectEngineMode } from "./runtime-capabilities.js";

const ENGINE_CONFIG = Object.freeze({
  threadedBundleAvailable: true,
  singleThread: {
    package: "@ffmpeg/ffmpeg@0.12.10",
    core: "@ffmpeg/core@0.12.6"
  },
  multiThread: {
    package: "@ffmpeg/ffmpeg@0.12.10",
    core: "@ffmpeg/core-mt@0.12.6",
    worker: "@ffmpeg/core-mt@0.12.6/dist/esm/ffmpeg-core.worker.js"
  }
});

export function getEnginePlan() {
  const capabilities = detectRuntimeCapabilities();
  const mode = selectEngineMode(capabilities, ENGINE_CONFIG);
  const blockers = [];
  if (!capabilities.secureContext) blockers.push("HTTPS غير متاح");
  if (!capabilities.wasm) blockers.push("WebAssembly غير مدعوم");
  if (!capabilities.sharedArrayBuffer) blockers.push("SharedArrayBuffer غير متاح");
  if (!capabilities.crossOriginIsolated) blockers.push("عزل COOP/COEP غير مفعّل");
  if (!ENGINE_CONFIG.threadedBundleAvailable) blockers.push("حزمة core-mt غير مفعّلة في الإعدادات");
  return {
    mode,
    capabilities,
    config: mode === "multi-thread" ? ENGINE_CONFIG.multiThread : ENGINE_CONFIG.singleThread,
    threadedBundleAvailable: ENGINE_CONFIG.threadedBundleAvailable,
    reason: mode === "multi-thread"
      ? "كل شروط Multi-thread متحققة؛ سيُحمّل core-mt."
      : "تم اختيار Single-thread لأن: " + (blockers.join("، ") || "شرط من شروط اختيار المحرك لم يتحقق.")
  };
}
