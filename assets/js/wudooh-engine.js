/**
 * WudoohEngine — محرك FFmpeg.wasm واحد لمعالجة الفيديو محلياً.
 * FFmpeg 0.12.6 + util 0.12.1
 */
import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/esm/index.js";
import { toBlobURL, fetchFile } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

export class WudoohEngine {
  constructor() {
    this.ffmpeg = null;
    this.loaded = false;
    this.busy = false;
    this.cancelled = false;
    this.logs = [];
    this.onProgress = null;
    this.onLog = null;
    this.activeMode = "not-loaded";
    this._loadPromise = null;
  }

  _log(message) {
    this.logs.push(String(message));
    if (this.logs.length > 500) this.logs.shift();
    try { this.onLog?.(String(message)); } catch {}
  }

  async load(multiThread = true) {
    if (this.loaded) return { mode: this.activeMode };
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      this.ffmpeg = ffmpeg;
      ffmpeg.on("log", ({ message }) => this._log(message));
      ffmpeg.on("progress", ({ progress }) => {
        try { this.onProgress?.(Math.min(0.99, Math.max(0, progress || 0))); } catch {}
      });

      try {
        const base = multiThread
          ? "https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm"
          : "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
        const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
        const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");
        const options = { coreURL, wasmURL };
        if (multiThread) {
          options.workerURL = await toBlobURL(`${base}/ffmpeg-core.worker.js`, "text/javascript");
        }
        await ffmpeg.load(options);
        if (this.ffmpeg !== ffmpeg) throw new Error("تم إلغاء تحميل المحرك.");
        this.loaded = true;
        this.activeMode = multiThread ? "multi-thread" : "single-thread";
        return { mode: this.activeMode };
      } catch (error) {
        try { ffmpeg.terminate(); } catch {}
        if (this.ffmpeg === ffmpeg) this.ffmpeg = null;
        this.loaded = false;
        if (multiThread && !this.cancelled) {
          this._loadPromise = null;
          return await this.load(false);
        }
        throw error;
      } finally {
        this._loadPromise = null;
      }
    })();
    return this._loadPromise;
  }

  async inspect(file) {
    if (!(file instanceof Blob)) throw new TypeError("اختر ملف فيديو أولاً.");
    const url = URL.createObjectURL(file);
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error("تعذّرت قراءة خصائص الفيديو. جرّب ملف MP4 أو MOV متوافقاً مع المتصفح."));
      });
      return {
        name: file.name || "video",
        size: file.size,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        fps: "غير متاح من فحص المتصفح",
        videoCodec: "غير متاح من فحص المتصفح",
        audioPresent: "غير متاح من فحص المتصفح",
        hdr: "غير متاح من فحص المتصفح"
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async _run(inputFile, args, onProgress) {
    if (this.busy) throw new Error("المحرك مشغول حالياً.");
    if (!(inputFile instanceof Blob)) throw new TypeError("ملف الفيديو غير صالح.");
    this.busy = true;
    this.cancelled = false;
    this.logs = [];
    this.onProgress = onProgress || null;
    let ffmpegAtStart = null;
    let inputWritten = false;
    try {
      if (!this.loaded) await this.load(true);
      if (this.cancelled || !this.ffmpeg) throw new Error("تم إلغاء العملية.");
      ffmpegAtStart = this.ffmpeg;
      await ffmpegAtStart.writeFile("input_video", await fetchFile(inputFile));
      inputWritten = true;
      if (this.cancelled) throw new Error("تم إلغاء العملية.");
      const exitCode = await ffmpegAtStart.exec(args);
      if (this.cancelled) throw new Error("تم إلغاء العملية.");
      if (exitCode !== 0) throw new Error(`فشلت المعالجة برمز ${exitCode}. راجع سجل المعالجة.`);
      const data = await ffmpegAtStart.readFile("output.mp4");
      const blob = new Blob([data], { type: "video/mp4" });
      if (!blob.size) throw new Error("الملف الناتج فارغ.");
      return { blob, size: blob.size, logs: [...this.logs] };
    } finally {
      if (ffmpegAtStart && this.ffmpeg === ffmpegAtStart) {
        try { if (inputWritten) await ffmpegAtStart.deleteFile("input_video"); } catch {}
        try { await ffmpegAtStart.deleteFile("output.mp4"); } catch {}
      }
      this.busy = false;
      this.onProgress = null;
    }
  }

  async processClassic(inputFile, onProgress) {
    return this._run(inputFile, [
      "-y", "-i", "input_video",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c", "copy", "-movflags", "+faststart", "-f", "mp4", "output.mp4"
    ], onProgress);
  }

  async processMax(inputFile, onProgress) {
    return this._run(inputFile, [
      "-y", "-i", "input_video",
      "-map", "0:v?", "-map", "0:a?",
      "-map_metadata", "0", "-map_chapters", "0",
      "-c", "copy", "-movflags", "+faststart", "-f", "mp4", "output.mp4"
    ], onProgress);
  }

  async _encoderAvailable(name) {
    const code = await this.ffmpeg.exec(["-hide_banner", "-encoders"]);
    const text = this.logs.join("\n");
    return code === 0 && text.includes(name);
  }

  async processCompress(inputFile, options = {}, onProgress) {
    const { codec = "libx264", crf = 23, preset = "fast", scale = null, audioBitrate = "128k" } = options;
    if (!Number.isInteger(Number(crf)) || Number(crf) < 16 || Number(crf) > 30) {
      throw new Error("قيمة CRF يجب أن تكون بين 16 و30.");
    }
    const allowedPresets = ["ultrafast","superfast","veryfast","faster","fast","medium","slow","slower","veryslow"];
    if (!allowedPresets.includes(preset)) throw new Error("إعداد السرعة غير صالح.");
    if (!["libx264","libx265"].includes(codec)) throw new Error("ترميز الضغط غير مدعوم.");
    if (!this.loaded) await this.load(true);
    this.logs = [];
    const available = await this._encoderAvailable(codec);
    if (!available) throw new Error(codec === "libx265"
      ? "ترميز H.265 غير متوفر في نسخة FFmpeg الحالية. اختر H.264."
      : "ترميز H.264 غير متوفر في نسخة FFmpeg الحالية.");
    const args = ["-y", "-i", "input_video"];
    if (scale) args.push("-vf", `scale=${scale}`);
    args.push("-c:v", codec, "-preset", preset, "-crf", String(crf),
      "-c:a", "aac", "-b:a", audioBitrate, "-movflags", "+faststart", "-f", "mp4", "output.mp4");
    return this._run(inputFile, args, onProgress);
  }

  async processLite(inputFile, onProgress) {
    return this.processCompress(inputFile, { scale: "-2:720", crf: 24, preset: "veryfast" }, onProgress);
  }

  async processAntiLag(inputFile, onProgress) {
    return this.processCompress(inputFile, { scale: "-2:1080", crf: 22, preset: "fast" }, onProgress);
  }

  async process(inputFile, options = {}) {
    const mode = String(options.mode || "CLASSIC").toUpperCase();
    const started = performance.now();
    let output;
    if (mode === "CLASSIC") output = await this.processClassic(inputFile, options.onProgress);
    else if (mode === "MAX") output = await this.processMax(inputFile, options.onProgress);
    else if (mode === "LITE") output = await this.processLite(inputFile, options.onProgress);
    else if (mode === "ANTILAG") output = await this.processAntiLag(inputFile, options.onProgress);
    else if (mode === "COMPRESS") output = await this.processCompress(inputFile, {
      codec: options.codec || "libx264",
      crf: options.crf ?? 23,
      preset: options.preset || "fast",
      audioBitrate: options.audioBitrate || "128k"
    }, options.onProgress);
    else throw new Error("وضع المعالجة غير معروف.");

    const url = URL.createObjectURL(output.blob);
    return {
      ...output, url,
      fileName: (inputFile.name || "video").replace(/\.[^.]+$/, "") + "_ready.mp4",
      inputBytes: inputFile.size,
      outputBytes: output.size,
      savedBytes: inputFile.size - output.size,
      elapsedSeconds: (performance.now() - started) / 1000,
      mode, engineMode: this.activeMode
    };
  }

  async cancel() {
    if (!this.busy && !this._loadPromise) return;
    this.cancelled = true;
    const old = this.ffmpeg;
    this.ffmpeg = null;
    this.loaded = false;
    this.activeMode = "not-loaded";
    try { old?.terminate(); } catch {}
  }

  getLogs() { return this.logs.join("\n"); }
  getLog() { return this.getLogs(); }

  destroy() {
    this.cancelled = true;
    try { this.ffmpeg?.terminate(); } catch {}
    this.ffmpeg = null;
    this.loaded = false;
    this.activeMode = "not-loaded";
  }
}
