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
    core: "@ffmpeg/core@0.12.10"
  },
  multiThread: {
    package: "@ffmpeg/ffmpeg@0.12.10",
    core: "@ffmpeg/core-mt@0.12.10",
    worker: "@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.worker.js"
  }
});

export function getEnginePlan() {
  const capabilities = detectRuntimeCapabilities();
  const mode = selectEngineMode(capabilities, ENGINE_CONFIG);
  return {
    mode,
    capabilities,
    config: mode === "multi-thread" ? ENGINE_CONFIG.multiThread : ENGINE_CONFIG.singleThread,
    reason: mode === "multi-thread"
      ? "المتصفح معزول ويدعم SharedArrayBuffer وحزمة المحرك متعددة الخيوط متوفرة."
      : "سيُستخدم محرك Single-Thread للتوافق أو كخيار احتياطي عند تعذّر تحميل المحرك متعدد الخيوط."
  };
}
