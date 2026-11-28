/**
 * Ibrahim Studio VideoEngine
 * Browser-only FFmpeg.wasm engine.
 * @ffmpeg/ffmpeg 0.12.15, @ffmpeg/util 0.12.2
 * @ffmpeg/core and @ffmpeg/core-mt 0.12.10
 */
const FFmpegPackage = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js";
const CORE_VERSION = "0.12.10";
const CORE_CDN = "https://cdn.jsdelivr.net/npm";
const CACHE_NAME = "ibrahim-video-engine-v1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const extOf = (name = "") => (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "mp4").toLowerCase();
const safeName = (name) => name.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "") || "video";
const timeToSeconds = (value) => {
  const match = value.match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
};

export class VideoEngine {
  constructor(options = {}) {
    this.options = {
      workerURL: new URL("../ffmpeg/worker.js", import.meta.url).href,
      preferMultiThread: true,
      cacheAssets: true,
      maxLogLines: 12000,
      ...options
    };
    this.ffmpeg = null;
    this.loaded = false;
    this.busy = false;
    this.cancelled = false;
    this.activeMode = "not-loaded";
    this.logs = [];
    this.objectURLs = [];
    this.duration = 0;
    this.lastError = null;
    this.onProgress = this.options.onProgress || (() => {});
    this.onLog = this.options.onLog || (() => {});
    this.onStatus = this.options.onStatus || (() => {});
    this._newFFmpeg();
  }

  _newFFmpeg() {
    this.ffmpeg = null;
    this._handlers = null;
  }

  async _getFFmpeg() {
    if (this.ffmpeg) return this.ffmpeg;
    const { FFmpeg } = await import(FFmpegPackage);
    this.ffmpeg = new FFmpeg();
    const log = ({ message }) => {
      this.logs.push(message);
      if (this.logs.length > this.options.maxLogLines) this.logs.shift();
      this.onLog(message, this.logs.length);
      const time = timeToSeconds(message);
      if (time !== null && this.duration > 0) {
        this.onProgress(Math.min(0.99, Math.max(0, time / this.duration)), { time, duration: this.duration, source: "ffmpeg-log" });
      }
    };
    const progress = ({ progress, time }) => {
      if (Number.isFinite(progress)) {
        this.onProgress(Math.min(0.99, Math.max(0, progress)), { time, duration: this.duration, source: "ffmpeg-progress" });
      }
    };
    this._handlers = { log, progress };
    this.ffmpeg.on("log", log);
    this.ffmpeg.on("progress", progress);
    return this.ffmpeg;
  }

  getCapabilities() {
    const secure = globalThis.isSecureContext === true;
    const sab = typeof SharedArrayBuffer !== "undefined";
    const isolated = globalThis.crossOriginIsolated === true;
    return {
      secureContext: secure,
      webAssembly: typeof WebAssembly === "object",
      sharedArrayBuffer: sab,
      crossOriginIsolated: isolated,
      multiThreadAvailable: secure && sab && isolated && typeof Worker !== "undefined",
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null
    };
  }

  async _assetURL(url, mime) {
    let blob = null;
    let cache = null;

    if (this.options.cacheAssets && "caches" in globalThis) {
      try {
        cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(url);
        if (cached) blob = await cached.blob();
      } catch (error) {
        console.warn("FFmpeg cache unavailable; fetching the asset directly.", error);
      }
    }

    if (!blob) {
      const response = await fetch(url, { mode: "cors", cache: "force-cache" });
      if (!response.ok) throw new Error(`تعذّر تحميل ملف المحرك: HTTP ${response.status}`);
      const copy = response.clone();
      blob = await response.blob();
      if (cache) {
        try { await cache.put(url, copy); }
        catch (error) { console.warn("FFmpeg cache write skipped.", error); }
      }
    }

    if (!blob.type) blob = new Blob([await blob.arrayBuffer()], { type: mime });
    const objectURL = URL.createObjectURL(blob);
    this.objectURLs.push(objectURL);
    return objectURL;
  }

  async _loadCore(multiThread) {
    const ffmpeg = await this._getFFmpeg();
    const flavor = multiThread ? "core-mt" : "core";
    const base = `${CORE_CDN}/@ffmpeg/${flavor}@${CORE_VERSION}/dist/esm`;
    this.onStatus(multiThread ? "تحميل المحرك متعدد الخيوط..." : "تحميل المحرك القياسي...");
    const specs = [
      ["ffmpeg-core.js", "text/javascript"],
      ["ffmpeg-core.wasm", "application/wasm"]
    ];
    if (multiThread) specs.push(["ffmpeg-core.worker.js", "text/javascript"]);
    const urls = await Promise.all(specs.map(([file, mime]) => this._assetURL(`${base}/${file}`, mime)));
    const config = {
      classWorkerURL: this.options.workerURL,
      coreURL: urls[0],
      wasmURL: urls[1]
    };
    if (multiThread) config.workerURL = urls[2];

    try {
      await ffmpeg.load(config);
      this.loaded = true;
      this.activeMode = multiThread ? "multi-thread" : "single-thread";
    } catch (error) {
      throw error;
    }
  }

  async load() {
    if (this.loaded) return { mode: this.activeMode, fallback: false };
    if (!this.getCapabilities().webAssembly) throw new Error("هذا المتصفح لا يدعم WebAssembly.");
    const capabilities = this.getCapabilities();
    const tryMulti = this.options.preferMultiThread && capabilities.multiThreadAvailable;

    if (tryMulti) {
      try {
        await this._loadCore(true);
        return { mode: this.activeMode, fallback: false };
      } catch (multiError) {
        this.onStatus("تعذّر تشغيل الوضع المتوازي؛ سيتم استخدام الوضع القياسي.");
        try { this.ffmpeg?.terminate(); } catch {}
        this._newFFmpeg();
        await this._loadCore(false);
        return { mode: this.activeMode, fallback: true, reason: multiError?.message || String(multiError) };
      }
    }

    await this._loadCore(false);
    return {
      mode: this.activeMode,
      fallback: this.options.preferMultiThread && !capabilities.multiThreadAvailable,
      reason: this.options.preferMultiThread && !capabilities.multiThreadAvailable
        ? "SharedArrayBuffer أو crossOriginIsolated غير متاح."
        : null
    };
  }

  async inspect(file) {
    if (!(file instanceof Blob)) throw new TypeError("اختر ملف فيديو أولاً.");
    await this.load();
    const ffmpeg = this.ffmpeg;
    const input = `inspect_input.${extOf(file.name)}`;
    this.onStatus("قراءة معلومات الفيديو...");
    const url = URL.createObjectURL(file);
    try {
      const browserMeta = await new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.onloadedmetadata = () => {
          resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
          video.src = "";
        };
        video.onerror = () => reject(new Error("تعذّرت قراءة بيانات الفيديو في المتصفح."));
        video.src = url;
      });
      await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
      const before = this.logs.length;
      await ffmpeg.exec(["-hide_banner", "-i", input]).catch(() => 1);
      const probeText = this.logs.slice(before).join("\n");
      const videoLine = probeText.split("\n").find((line) => /Video:/.test(line)) || "";
      const audioLine = probeText.split("\n").find((line) => /Audio:/.test(line)) || "";
      const codec = videoLine.match(/Video:\s*([^, (]+)/i)?.[1] || "غير معروف";
      const fps = videoLine.match(/([0-9.]+)\s*fps/i)?.[1] || null;
      const hdr = /smpte2084|arib-std-b67|bt2020|HDR10|HLG/i.test(probeText);
      return {
        name: file.name,
        size: file.size,
        width: browserMeta.width,
        height: browserMeta.height,
        duration: browserMeta.duration,
        fps: fps ? Number(fps) : null,
        videoCodec: codec,
        audioPresent: Boolean(audioLine),
        audioInfo: audioLine || null,
        hdr,
        hdrInfo: hdr ? (probeText.match(/(?:smpte2084|arib-std-b67|bt2020|HDR10|HLG)[^\n]*/i)?.[0] || "قد يحتوي على HDR") : "لم يتم رصد بيانات HDR",
        rawProbe: probeText
      };
    } finally {
      URL.revokeObjectURL(url);
      try { await ffmpeg.deleteFile(input); } catch {}
    }
  }

  _buildArgs(input, output, mode, settings, metadata) {
    const ext = extOf(output);
    const fastStart = ["mp4", "m4v", "mov"].includes(ext) ? ["-movflags", "+faststart"] : [];
    if (mode === "CLASSIC") {
      return ["-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", ...fastStart, output];
    }
    if (mode === "MAX") {
      return ["-y", "-i", input, "-map", "0", "-c", "copy", "-map_metadata", "0", "-map_chapters", "0", ...fastStart, output];
    }

    const codec = settings.codec === "libx265" ? "libx265" : "libx264";
    const crf = Math.max(16, Math.min(30, Number(settings.crf ?? 22)));
    const preset = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"].includes(settings.preset)
      ? settings.preset : "fast";
    const audioBitrate = ["96k", "128k", "160k", "192k", "256k"].includes(settings.audioBitrate)
      ? settings.audioBitrate : "160k";
    const args = [
      "-y", "-i", input,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", codec, "-preset", preset, "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", audioBitrate,
      "-movflags", "+faststart"
    ];
    if (codec === "libx265") args.push("-tag:v", "hvc1");
    if (metadata?.hdr && codec === "libx264") {
      this.onStatus("تنبيه: ضغط HDR باستخدام H.264 قد يحوّل الألوان/النطاق الديناميكي. استخدم MAX للحفاظ على المصدر.");
    }
    args.push(output);
    return args;
  }

  async process(file, options = {}) {
    if (this.busy) throw new Error("هناك عملية معالجة قيد التنفيذ.");
    if (!(file instanceof Blob)) throw new TypeError("اختر ملف فيديو أولاً.");
    const mode = String(options.mode || "MAX").toUpperCase();
    if (!["CLASSIC", "MAX", "COMPRESS"].includes(mode)) throw new Error("وضع المعالجة غير معروف.");
    this.busy = true;
    this.cancelled = false;
    this.lastError = null;
    this.logs = [];
    const startedAt = performance.now();
    let input = `input.${extOf(file.name)}`;
    const outputExt = mode === "COMPRESS" ? "mp4" : extOf(file.name);
    const output = `ibrahim_output.${outputExt}`;
    let ffmpeg;
    try {
      await this.load();
      ffmpeg = this.ffmpeg;
      this.duration = Number(options.metadata?.duration || 0);
      this.onProgress(0, { phase: "start" });
      this.onStatus("كتابة الفيديو في ذاكرة المتصفح...");
      await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
      if (this.cancelled) throw new Error("تم إلغاء المعالجة.");
      if (mode === "COMPRESS") {
        const requestedEncoder = options.codec === "libx265" ? "libx265" : "libx264";
        const logStart = this.logs.length;
        await ffmpeg.exec(["-hide_banner", "-encoders"]);
        const encoderList = this.logs.slice(logStart).join("\\n");
        if (!encoderList.includes(requestedEncoder)) {
          throw new Error(`ترميز ${requestedEncoder} غير متوفر في نسخة FFmpeg الحالية. اختر H.264 أو استخدم نسخة Core مبنية مع هذا الترميز.`);
        }
      }
      const args = this._buildArgs(input, output, mode, options, options.metadata);
      this.onStatus(mode === "COMPRESS" ? "إعادة ترميز الفيديو..." : "نسخ مسارات الفيديو والصوت...");
      const exitCode = await ffmpeg.exec(args);
      if (this.cancelled) throw new Error("تم إلغاء المعالجة.");
      if (exitCode !== 0) throw new Error(`انتهى FFmpeg برمز خطأ ${exitCode}. راجع السجل.`);
      this.onStatus("قراءة الملف الناتج...");
      const data = await ffmpeg.readFile(output);
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const mime = outputExt === "webm" ? "video/webm" : outputExt === "mov" ? "video/quicktime" : "video/mp4";
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      this.objectURLs.push(url);
      this.onProgress(1, { phase: "complete" });
      this.onStatus("اكتملت المعالجة بنجاح.");
      return {
        blob, url,
        fileName: `${safeName(file.name.replace(/\.[^.]+$/, ""))}_ready.${outputExt}`,
        inputBytes: file.size,
        outputBytes: blob.size,
        savedBytes: file.size - blob.size,
        elapsedSeconds: (performance.now() - startedAt) / 1000,
        mode, engineMode: this.activeMode,
        log: this.getLog()
      };
    } catch (error) {
      this.lastError = error;
      if (this.cancelled) throw new Error("أُلغيت العملية.");
      throw error;
    } finally {
      if (ffmpeg && !this.cancelled) {
        try { await ffmpeg.deleteFile(input); } catch {}
        try { await ffmpeg.deleteFile(output); } catch {}
      }
      this.busy = false;
      this.duration = 0;
    }
  }

  cancel() {
    if (!this.busy) return false;
    this.cancelled = true;
    try { this.ffmpeg?.terminate(); } catch {}
    this.loaded = false;
    this.activeMode = "not-loaded";
    this._newFFmpeg();
    this.onStatus("تم إيقاف المعالجة. أعد تحميل المحرك عند بدء العملية التالية.");
    return true;
  }

  getLog() {
    return this.logs.join("\n");
  }

  download(result) {
    if (!result?.url) throw new Error("لا يوجد ملف جاهز للتنزيل.");
    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = result.fileName || "video_ready.mp4";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  destroy() {
    try { this.ffmpeg?.terminate(); } catch {}
    for (const url of this.objectURLs) URL.revokeObjectURL(url);
    this.objectURLs = [];
    this.loaded = false;
    this.busy = false;
    this._newFFmpeg();
  }
}
