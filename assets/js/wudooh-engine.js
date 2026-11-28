/**
 * WudoohEngine — محرك FFmpeg.wasm واحد لمعالجة الفيديو محلياً.
 * FFmpeg 0.12.9 + util 0.12.1
 */
import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.9/dist/esm/index.js";
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
    this.onStatus = null;
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
        const options = {
          coreURL,
          wasmURL,
          classWorkerURL: new URL("./ffmpeg/worker.js", import.meta.url).href
        };
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
    if (this.busy) throw new Error("المحرك مشغول حالياً.");
    this.busy = true;
    this.logs = [];
    let wrote = false;
    let active = null;
    try {
      if (!this.loaded) await this.load(true);
      active = this.ffmpeg;
      if (!active) throw new Error("تعذّر تحميل محرك فحص الفيديو.");
      this._log("بدء فحص بيانات الملف باستخدام FFmpeg...");
      const bytes = await fetchFile(file);
      await active.writeFile("inspect_input", bytes);
      wrote = true;
      await active.exec(["-hide_banner", "-i", "inspect_input"]);
      const report = this.logs.join("\n");
      const lines = report.split("\n");
      const videoLine = lines.find(line => /Stream #\d+:\d+.*Video:/i.test(line)) || "";
      const audioLine = lines.find(line => /Stream #\d+:\d+.*Audio:/i.test(line)) || "";
      const durationMatch = report.match(/Duration:\s*(\d+):(\d+):([\d.]+)/i);
      const duration = durationMatch ? (+durationMatch[1] * 3600 + +durationMatch[2] * 60 + +durationMatch[3]) : 0;
      const sizeMatch = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
      const codecMatch = videoLine.match(/Video:\s*([^,\s]+)(?:\s*\(([^)]*)\))?/i);
      const pixelMatch = videoLine.match(/Video:\s*[^,]+,\s*([^,\s]+)/i);
      const fpsMatch = videoLine.match(/([\d.]+)\s*fps/i);
      const videoRateMatch = videoLine.match(/([\d.]+)\s*kb\/s/i);
      const audioCodecMatch = audioLine.match(/Audio:\s*([^,\s]+)(?:\s*\[([^\]]+)\])?/i);
      const sampleMatch = audioLine.match(/(\d+)\s*Hz/i);
      const audioRateMatch = audioLine.match(/([\d.]+)\s*kb\/s/i);
      const formatMatch = report.match(/Input #0,\s*([^,\s]+)/i);
      const totalRateMatch = report.match(/bitrate:\s*([\d.]+\s*\w+\/s)/i);
      const colorText = (videoLine.match(/Video:\s*[^,]+,\s*[^,]+,\s*([^,]+(?:,\s*[^,]+){0,3})/i) || [,""])[1];
      const transfer = (videoLine.match(/\b(smpte2084|arib-std-b67|bt709|bt2020)\b/i) || [,""])[1];
      const hdr = /smpte2084|arib-std-b67/i.test(videoLine) ? "HDR" : /bt709/i.test(videoLine) ? "SDR" : "غير محدد";
      const bitDepth = /p010|p012|10le|10be/i.test(videoLine) ? "10-bit أو أكثر" : pixelMatch ? "8-bit غالباً" : "غير متاح";
      const channels = (audioLine.match(/\b(mono|stereo|2\.1|5\.1|7\.1)\b/i) || [,"غير محدد"])[1];
      const rotation = (report.match(/rotation of (-?\d+(?:\.\d+)?)/i) || [,"0"])[1];
      if (!videoLine) throw new Error("لم يتم العثور على مسار فيديو قابل للقراءة. جرّب ملف MP4 أو MOV.");
      return {
        name: file.name || "video", size: file.size,
        width: sizeMatch ? Number(sizeMatch[1]) : 0,
        height: sizeMatch ? Number(sizeMatch[2]) : 0,
        duration, fps: fpsMatch ? fpsMatch[1] + " FPS" : "غير متاح",
        videoCodec: codecMatch ? codecMatch[1] : "غير متاح",
        videoProfile: codecMatch?.[2] || "غير متاح",
        pixelFormat: pixelMatch?.[1] || "غير متاح",
        bitDepth, colorDetails: colorText.trim() || "غير متاح",
        colorTransfer: transfer || "غير متاح", hdr,
        colorRange: /\btv\b/i.test(videoLine) ? "Limited (TV)" : /\bpc\b/i.test(videoLine) ? "Full (PC)" : "غير محدد",
        audioPresent: audioLine ? "موجود" : "لا يوجد",
        audioCodec: audioCodecMatch ? audioCodecMatch[1] : "لا يوجد",
        audioChannels: audioLine ? channels : "لا يوجد",
        audioSampleRate: sampleMatch ? sampleMatch[1] + " Hz" : "غير متاح",
        audioBitrate: audioRateMatch ? audioRateMatch[1] + " kb/s" : "غير متاح",
        container: formatMatch?.[1] || "غير متاح",
        bitrate: totalRateMatch?.[1] || "غير متاح",
        videoBitrate: videoRateMatch ? videoRateMatch[1] + " kb/s" : "غير متاح",
        rotation, raw: report
      };
    } finally {
      if (active && wrote) { try { await active.deleteFile("inspect_input"); } catch {} }
      this.busy = false;
    }
  }

  async inspectAdvanced(file) {
    if (!(file instanceof Blob)) throw new TypeError("اختر ملف فيديو أولاً.");
    if (this.busy) throw new Error("المحرك مشغول حالياً.");
    this.busy = true;
    this.logs = [];
    let wrote = false;
    let active = null;
    try {
      if (!this.loaded) await this.load(true);
      active = this.ffmpeg;
      if (!active) throw new Error("تعذّر تحميل محرك التحليل المتقدم.");
      this._log("بدء تحليل الإطارات: GOP / CFR / I-P-B...");
      this._log("تنبيه: هذا التحليل يفك ترميز الفيديو محلياً للقراءة فقط ولا ينشئ ملفاً جديداً.");
      const bytes = await fetchFile(file);
      await active.writeFile("advanced_input", bytes);
      wrote = true;
      await active.exec([
        "-hide_banner", "-i", "advanced_input",
        "-map", "0:v:0", "-an", "-sn", "-dn",
        "-vf", "showinfo", "-f", "null", "-"
      ]);
      const report = this.logs.join("\\n");
      const frameRegex = /showinfo.*?n:\\s*(\\d+).*?pts_time:\\s*(-?[\\d.]+).*?iskey:\\s*(\\d+).*?type:\\s*([IPB?])/gi;
      const frames = [];
      let match;
      while ((match = frameRegex.exec(report)) !== null) {
        frames.push({ n: Number(match[1]), time: Number(match[2]), key: match[3] === "1", type: match[4].toUpperCase() });
      }
      if (!frames.length) {
        throw new Error("لم يستطع إصدار FFmpeg استخراج بيانات showinfo. انسخ السجل وأرسله للفحص.");
      }
      const deltas = [];
      for (let i = 1; i < frames.length; i++) {
        const delta = frames[i].time - frames[i - 1].time;
        if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
      }
      const sorted = [...deltas].sort((a,b)=>a-b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const tolerance = Math.max(0.0005, median * 0.02);
      const cfr = !!median && deltas.every(value => Math.abs(value - median) <= tolerance);
      const keyframes = frames.filter(frame => frame.key);
      const gops = [];
      for (let i = 1; i < keyframes.length; i++) gops.push(keyframes[i].n - keyframes[i - 1].n);
      const types = frames.reduce((acc, frame) => { acc[frame.type] = (acc[frame.type] || 0) + 1; return acc; }, {});
      const averageGop = gops.length ? gops.reduce((a,b)=>a+b,0) / gops.length : 0;
      const fps = median ? 1 / median : 0;
      const result = {
        analyzedFrames: frames.length,
        keyframeCount: keyframes.length,
        gopAverage: averageGop ? averageGop.toFixed(1) + " إطار" : "غير كافٍ",
        gopMin: gops.length ? Math.min(...gops) + " إطار" : "غير متاح",
        gopMax: gops.length ? Math.max(...gops) + " إطار" : "غير متاح",
        cfr: cfr ? "ثابت CFR" : "متغير VFR أو توقيت غير منتظم",
        measuredFps: fps ? fps.toFixed(3) + " FPS" : "غير متاح",
        iFrames: types.I || 0,
        pFrames: types.P || 0,
        bFrames: types.B || 0,
        keyframeIntervals: gops
      };
      this._log("التحليل اكتمل: " + frames.length + " إطار، " + keyframes.length + " إطار مفتاحي، " + result.cfr + ".");
      return result;
    } finally {
      if (active && wrote) { try { await active.deleteFile("advanced_input"); } catch {} }
      this.busy = false;
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
    const report = message => { try { this.onStatus?.(message); } catch {} };
    try {
      if (!this.loaded) {
        report("جارٍ تحميل محرك FFmpeg لأول مرة...");
        await this.load(true);
      }
      if (this.cancelled || !this.ffmpeg) throw new Error("تم إلغاء العملية.");
      ffmpegAtStart = this.ffmpeg;
      report("جارٍ قراءة ملف الفيديو وتجهيزه...");
      const inputData = await fetchFile(inputFile);
      if (this.cancelled) throw new Error("تم إلغاء العملية.");
      await ffmpegAtStart.writeFile("input_video", inputData);
      inputWritten = true;
      if (this.cancelled) throw new Error("تم إلغاء العملية.");
      report("جارٍ نسخ الفيديو دون إعادة ترميز. قد تبقى النسبة 0% في وضع CLASSIC...");
      const exitCode = await ffmpegAtStart.exec(args);
      if (this.cancelled) throw new Error("تم إلغاء العملية.");
      if (exitCode !== 0) throw new Error(`فشلت المعالجة برمز ${exitCode}. راجع سجل المعالجة.`);
      report("انتهى النسخ، جارٍ تجهيز الملف للتنزيل...");
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
      this.onStatus = null;
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
