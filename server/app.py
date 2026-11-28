import asyncio
import json
import os
import re
import secrets
import shutil
import tempfile
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

WORK_DIR = Path(os.getenv("WORK_DIR", "/tmp/ibrahim-studio-jobs"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "500")) * 1024 * 1024
MAX_DURATION_SECONDS = int(os.getenv("MAX_DURATION_SECONDS", "600"))
JOB_TTL_SECONDS = int(os.getenv("JOB_TTL_SECONDS", "900"))
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}
ALLOWED_ORIGINS = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "https://tik-a8h.pages.dev").split(",") if x.strip()]

TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY", "").strip()
TURNSTILE_EXPECTED_HOSTNAME = os.getenv("TURNSTILE_EXPECTED_HOSTNAME", "tik-a8h.pages.dev").strip().lower()

app = FastAPI(title="Ibrahim Studio HandBrake API", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Job-Token"],
)

jobs: dict[str, dict[str, Any]] = {}
job_slots = asyncio.Semaphore(1)
ip_requests: dict[str, deque[float]] = defaultdict(deque)


def append_log(job: dict[str, Any], line: str) -> None:
    clean = line.strip()
    if clean:
        job["logs"].append(clean[:700])
        job["logs"] = job["logs"][-50:]


def remove_job_files(job: dict[str, Any]) -> None:
    folder = job.get("folder")
    if folder:
        shutil.rmtree(folder, ignore_errors=True)


async def run_command(*args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    output, _ = await proc.communicate()
    return proc.returncode or 0, output.decode("utf-8", "replace")


async def probe(path: Path) -> dict[str, Any]:
    code, output = await run_command(
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size:stream=codec_type,width,height",
        "-of", "json", str(path)
    )
    if code != 0:
        raise ValueError("تعذّر قراءة معلومات الفيديو. تأكد أن الملف فيديو صالح.")
    data = json.loads(output or "{}")
    streams = data.get("streams", [])
    if not any(s.get("codec_type") == "video" for s in streams):
        raise ValueError("لم يتم العثور على مسار فيديو داخل الملف.")
    duration = float(data.get("format", {}).get("duration") or 0)
    if duration <= 0:
        raise ValueError("تعذّر تحديد مدة الفيديو.")
    if duration > MAX_DURATION_SECONDS:
        raise ValueError(f"الحد الأقصى لمدة الفيديو هو {MAX_DURATION_SECONDS // 60} دقائق.")
    return {
        "duration": duration,
        "width": next((s.get("width") for s in streams if s.get("codec_type") == "video"), None),
        "height": next((s.get("height") for s in streams if s.get("codec_type") == "video"), None),
    }


async def execute_job(job_id: str) -> None:
    job = jobs.get(job_id)
    if not job:
        return
    async with job_slots:
        if job.get("cancelled"):
            job["status"] = "cancelled"
            return
        job["status"] = "processing"
        job["started_at"] = time.time()
        source = Path(job["source"])
        output = Path(job["output"])
        command = [
            "HandBrakeCLI", "--json", "-i", str(source), "-o", str(output),
            "--format", "av_mp4", "--encoder", "x264", "--quality", "22",
            "--encoder-preset", "veryfast", "--maxWidth", "1920", "--maxHeight", "1080",
            "--all-audio", "--aencoder", "av_aac", "--ab", "160", "--optimize",
        ]
        append_log(job, "بدء HandBrakeCLI على الخادم.")
        proc = await asyncio.create_subprocess_exec(
            *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        job["process"] = proc
        buffer = ""
        try:
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", "replace")
                parts = re.split(r"[\r\n]+", buffer)
                buffer = parts.pop()
                for line in parts:
                    append_log(job, line)
                    match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
                    json_progress = re.search(r'"Progress"\s*:\s*(\d+(?:\.\d+)?)', line)
                    if match:
                        job["progress"] = min(99, max(1, int(float(match.group(1)))))
                    elif json_progress:
                        value = float(json_progress.group(1))
                        if 0 <= value <= 1:
                            value *= 100
                        job["progress"] = min(99, max(1, int(value)))
            if buffer:
                append_log(job, buffer)
            code = await proc.wait()
            job["process"] = None
            if job.get("cancelled"):
                job["status"] = "cancelled"
                append_log(job, "تم إيقاف المهمة بناءً على طلب المستخدم.")
                remove_job_files(job)
                return
            if code != 0 or not output.exists() or output.stat().st_size == 0:
                job["status"] = "failed"
                job["finished_at"] = time.time()
                job["error"] = "فشل HandBrake في إنشاء ملف الناتج."
                append_log(job, f"انتهى HandBrake برمز خروج {code}.")
                remove_job_files(job)
                return
            output_info = await probe(output)
            job["progress"] = 100
            job["status"] = "completed"
            job["completed_at"] = time.time()
            job["report"] = {
                "processingMode": "handbrake-server",
                "activeMode": "server-handbrake",
                "plannedMode": "server-handbrake",
                "planReason": "إعادة ترميز فعلية باستخدام HandBrakeCLI على الخادم.",
                "fallbackUsed": False,
                "fallbackReason": "",
                "processingSeconds": round(job["completed_at"] - job["started_at"], 2),
                "encodeSeconds": round(job["completed_at"] - job["started_at"], 2),
                "loadSeconds": 0,
                "sourceBytes": job["source_bytes"],
                "outputBytes": output.stat().st_size,
                "sourceDurationSeconds": job["source_info"]["duration"],
                "outputDurationSeconds": output_info["duration"],
                "outputWidth": output_info["width"],
                "outputHeight": output_info["height"],
                "tool": "HandBrakeCLI",
            }
            append_log(job, "اكتمل الترميز. الملف المؤقت جاهز للتنزيل.")
        except Exception as exc:
            job["process"] = None
            job["status"] = "failed"
            job["finished_at"] = time.time()
            job["error"] = str(exc)[:300]
            append_log(job, "خطأ أثناء المعالجة: " + str(exc)[:300])
            remove_job_files(job)


@app.on_event("startup")
async def startup() -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    asyncio.create_task(expire_jobs())


async def expire_jobs() -> None:
    while True:
        now = time.time()
        for job_id, job in list(jobs.items()):
            # Never expire an actively processing job. Its creation time includes
            # upload time, and slow free instances may need longer than the TTL.
            if job.get("status") == "processing":
                continue
            expiry_base = job.get("completed_at") or job.get("finished_at") or job.get("created_at", now)
            if now - expiry_base > JOB_TTL_SECONDS:
                proc = job.get("process")
                if proc and proc.returncode is None:
                    proc.terminate()
                remove_job_files(job)
                jobs.pop(job_id, None)
        await asyncio.sleep(60)


@app.get("/health")
async def health():
    hb = await run_command("HandBrakeCLI", "--version")
    fp = await run_command("ffprobe", "-version")
    return {
        "ok": hb[0] == 0 and fp[0] == 0,
        "handbrake": hb[1].splitlines()[0] if hb[1] else "unavailable",
        "ffprobe": fp[1].splitlines()[0] if fp[1] else "unavailable",
        "maxUploadMB": MAX_UPLOAD_BYTES // (1024 * 1024),
        "maxDurationSeconds": MAX_DURATION_SECONDS,
        "temporaryStorageOnly": True,
    }


async def verify_turnstile(token: str, remote_ip: str | None) -> None:
    if not TURNSTILE_SECRET_KEY:
        raise HTTPException(503, "حماية Cloudflare غير مهيأة على الخادم.")
    if not token or len(token) > 2048:
        raise HTTPException(400, "أكمل فحص الحماية قبل رفع الفيديو.")
    import httpx
    payload = {"secret": TURNSTILE_SECRET_KEY, "response": token}
    if remote_ip and remote_ip != "unknown":
        payload["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", data=payload)
            response.raise_for_status()
            result = response.json()
    except Exception:
        raise HTTPException(503, "تعذّر الاتصال بخدمة التحقق. حاول مرة أخرى.")
    hostname = str(result.get("hostname", "")).lower()
    if not result.get("success") or hostname != TURNSTILE_EXPECTED_HOSTNAME:
        raise HTTPException(403, "فشل فحص الحماية أو أن اسم الموقع غير مطابق.")

def require_job_access(job: dict[str, Any] | None, supplied_token: str | None) -> dict[str, Any]:
    if not job:
        raise HTTPException(404, "انتهت صلاحية المهمة أو لم يتم العثور عليها.")
    expected = str(job.get("access_token", ""))
    if not supplied_token or not secrets.compare_digest(expected, supplied_token):
        raise HTTPException(403, "رمز الوصول للمهمة غير صالح.")
    return job


@app.post("/api/jobs")
async def create_job(request: Request, file: UploadFile = File(...), turnstile_token: str = Form(...)):
    client_ip = request.client.host if request.client else "unknown"
    await verify_turnstile(turnstile_token, client_ip)

    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    recent = ip_requests[client_ip]
    while recent and now - recent[0] > 600:
        recent.popleft()
    if len(recent) >= 3:
        raise HTTPException(429, "تم تجاوز عدد الطلبات المؤقتة. حاول بعد قليل.")
    recent.append(now)

    suffix = Path(file.filename or "video.mp4").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "الصيغ المدعومة: MP4 وMOV وM4V وMKV وWEBM.")
    job_id = secrets.token_urlsafe(18)
    folder = Path(tempfile.mkdtemp(prefix=f"{job_id}_", dir=WORK_DIR))
    source = folder / ("source" + suffix)
    output = folder / "processed.mp4"
    size = 0
    try:
        with source.open("wb") as target:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, f"الحد الأقصى لحجم الفيديو {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
                target.write(chunk)
        if size == 0:
            raise HTTPException(400, "الملف فارغ.")
        info = await probe(source)
    except HTTPException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(400, str(exc)[:300])
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    finally:
        await file.close()

    jobs[job_id] = {
        "id": job_id, "access_token": secrets.token_urlsafe(32), "status": "queued", "progress": 0, "logs": [],
        "created_at": now, "folder": str(folder), "source": str(source),
        "output": str(output), "source_bytes": size, "source_info": info,
        "process": None, "cancelled": False,
    }
    asyncio.create_task(execute_job(job_id))
    return {"id": job_id, "access_token": jobs[job_id]["access_token"], "status": "queued", "source": info}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str, x_job_token: str | None = Header(default=None)):
    job = require_job_access(jobs.get(job_id), x_job_token)
    return {
        "id": job_id, "status": job["status"], "progress": job["progress"],
        "error": job.get("error"), "logs": job["logs"][-50:],
        "report": job.get("report"),
    }


@app.get("/api/jobs/{job_id}/download")
async def download_job(job_id: str, x_job_token: str | None = Header(default=None)):
    job = require_job_access(jobs.get(job_id), x_job_token)
    if job.get("status") != "completed":
        raise HTTPException(409, "الفيديو لم يصبح جاهزاً للتنزيل.")
    output = Path(job["output"])
    if not output.exists():
        raise HTTPException(404, "انتهت صلاحية الملف المؤقت.")
    jobs.pop(job_id, None)
    return FileResponse(
        output, media_type="video/mp4", filename="ibrahim-studio-handbrake.mp4",
        background=BackgroundTask(remove_job_files, job),
        headers={"Cache-Control": "no-store, private"},
    )


@app.delete("/api/jobs/{job_id}")
async def cancel_job(job_id: str, x_job_token: str | None = Header(default=None)):
    job = require_job_access(jobs.get(job_id), x_job_token)
    job["cancelled"] = True
    proc = job.get("process")
    if proc and proc.returncode is None:
        proc.terminate()
    job["status"] = "cancelled"
    job["finished_at"] = time.time()
    append_log(job, "تم طلب إلغاء المهمة.")
    remove_job_files(job)
    jobs.pop(job_id, None)
    return {"ok": True, "status": "cancelled"}
