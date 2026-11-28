FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg handbrake-cli ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
COPY server/app.py .
RUN useradd --create-home --uid 10001 appuser && mkdir -p /tmp/ibrahim-studio-jobs && chown -R appuser:appuser /app /tmp/ibrahim-studio-jobs
USER appuser
EXPOSE 10000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "10000"]
