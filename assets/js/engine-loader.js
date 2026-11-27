/**
 * Engine selection scaffold.
 *
 * The existing production studio currently uses the single-thread FFmpeg core.
 * Do not set threadedBundleAvailable=true until a matching @ffmpeg/core-mt build,
 * worker assets and browser integration tests have been added to this repository.
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
      : "سيُستخدم محرك Single-Thread للتوافق؛ سيُستخدم Single-Thread كخيار احتياطي عند تعذّر تحميل المحرك متعدد الخيوط."
  };
}
