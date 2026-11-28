/**
 * WudoohEngine — محرك FFmpeg.wasm واحد لمعالجة الفيديو محلياً.
 * يعتمد على FFmpeg 0.12.6 و util 0.12.1.
 */
import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/esm/index.js";
import { toBlobURL, fetchFile } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

export class WudoohEngine {
  constructor() {
    this.ffmpeg = null;
    this.loaded = false;
    this.busy = false;
    this.logs = [];
    this.onProgress = null;
    this.onLog = null;
    this.activeMode = "not-loaded";
    this._loadPromise = null;
  }

  async load(multiThread = true) {
    if (this.loaded) return { mode: this.activeMode };
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      this.ffmpeg = ffmpeg;
      ffmpeg.on("log", ({ message }) => {
        this.logs.push(message);
        if (this.logs.length > 300) this.logs.shift();
        if (this.onLog) this.onLog(message);
      });
      ffmpeg.on("progress", ({ progress }) => {
        if (this.onProgress) this.onProgress(Math.min(0.99, Math.max(0.01, progress || 0)));
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
        this.loaded = true;
        this.activeMode = multiThread ? "multi-thread" : "single-thread";
        return { mode: this.activeMode };
      } catch (error) {
        try { ffmpeg.terminate(); } catch {}
        if (this.ffmpeg === ffmpeg) this.ffmpeg = null;
        this.loaded = false;
        if (multiThread) {
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
        video.onerror = () => reject(new Error("تعذّرت قراءة خصائص الفيديو من المتصفح."));
      });
      return {
        name: file.name || "video",
        size: file.size,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        fps: "غير متاح",
        videoCodec: "غير متاح عبر فحص المتصفح",
        audioPresent: "غير معروف",
        hdr: false
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async processClassic(inputFile, onProgress) {
    return this._run(inputFile, [
      "-y", "-i", "input",
      "-c", "copy",
      "-movflags", "+faststart",
      "output.mp4"
    ], onProgress);
  }

  async processCompress(inputFile, options = {}, onProgress) {
    const {
      crf = 23,
      preset = "fast",
      scale = null,
      audioBitrate = "128k"
    } = options;
    const args = ["-y", "-i", "input"];
    if (scale) args.push("-vf", `scale=${scale}`);
    args.push(
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-c:a", "aac",
      "-b:a", audioBitrate,
      "-movflags", "+faststart",
      "output.mp4"
    );
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
    if (mode === "CLASSIC" || mode === "MAX") {
      output = await this.processClassic(inputFile, options.onProgress);
    } else if (mode === "LITE") {
      output = await this.processLite(inputFile, options.onProgress);
    } else if (mode === "ANTILAG") {
      output = await this.processAntiLag(inputFile, options.onProgress);
    } else if (mode === "COMPRESS") {
      output = await this.processCompress(inputFile, {
        crf: options.crf ?? 23,
        preset: options.preset || "fast",
        audioBitrate: options.audioBitrate || "128k"
      }, options.onProgress);
    } else {
      throw new Error("وضع المعالجة غير معروف.");
    }
    const url = URL.createObjectURL(output.blob);
    return {
      ...output,
      url,
      fileName: (inputFile.name || "video").replace(/\.[^.]+$/, "") + "_ready.mp4",
      inputBytes: inputFile.size,
      outputBytes: output.size,
      savedBytes: inputFile.size - output.size,
      elapsedSeconds: (performance.now() - started) / 1000,
      mode,
      engineMode: this.activeMode
    };
  }

  async _run(inputFile, args, onProgress) {
    if (this.busy) throw new Error("المحرك مشغول حالياً");
    this.busy = true;
    this.logs = [];
    this.onProgress = onProgress || null;
    let inputWritten = false;
    try {
      if (!this.loaded) await this.load(true);
      await this.ffmpeg.writeFile("input", await fetchFile(inputFile));
      inputWritten = true;
      const exitCode = await this.ffmpeg.exec(args);
      if (exitCode !== 0) throw new Error(`فشلت المعالجة برمز ${exitCode}. راجع سجل المعالجة.`);
      const data = await this.ffmpeg.readFile("output.mp4");
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      return { blob, size: blob.size, logs: [...this.logs] };
    } finally {
      try { if (inputWritten) await this.ffmpeg?.deleteFile("input"); } catch {}
      try { await this.ffmpeg?.deleteFile("output.mp4"); } catch {}
      this.busy = false;
      this.onProgress = null;
    }
  }

  async cancel() {
    if (this.ffmpeg && this.busy) {
      try { this.ffmpeg.terminate(); } catch {}
      this.ffmpeg = null;
      this.loaded = false;
      this.activeMode = "not-loaded";
      this.busy = false;
      this._loadPromise = null;
    }
  }

  getLogs() {
    return this.logs.join("\n");
  }

  getLog() {
    return this.getLogs();
  }

  destroy() {
    try { this.ffmpeg?.terminate(); } catch {}
    this.ffmpeg = null;
    this.loaded = false;
    this.busy = false;
    this.activeMode = "not-loaded";
  }
}
