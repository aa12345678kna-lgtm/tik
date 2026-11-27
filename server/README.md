# Ibrahim Studio — temporary HandBrake API

This service is an optional server-side processing path. Existing browser FFmpeg modes remain separate and unchanged.

## Behavior

- Accepts MP4, MOV, M4V, MKV, and WEBM uploads.
- Maximum upload: 500 MB.
- Maximum duration: 10 minutes.
- Runs HandBrakeCLI with H.264 output, MP4 container, a 1080p maximum frame size, and source-timestamp frame-rate handling (HandBrake's default VFR behavior).
- Keeps at most one HandBrake process active at a time.
- Exposes job status, progress, the last 50 processing log lines, cancellation, and a one-time download endpoint.
- Stores source and output only in a temporary directory. The directory is removed after download, cancellation, processing failure, or the 15-minute job expiry.
- No video library or permanent video storage is configured.

## Deploy on Render

The repository includes a Render Blueprint at the root (render.yaml). Import the repository as a Blueprint in Render and review the service before deploying. The service uses the free web-service plan for testing.

After Render creates the service, copy its onrender.com URL. Add that URL to the frontend configuration in index.html as window.IBRAHIM_HANDBRAKE_API (the URL is intentionally blank until a real service exists), then publish the frontend.

## Important free-tier limitations

Render free web services can spin down after 15 minutes without traffic, take about a minute to wake, and may restart. Their filesystem is ephemeral. The free instance has 512 MB RAM and less than one CPU, so large or high-resolution videos may fail or run slowly. This is a test deployment, not a guaranteed production transcoding service.

Do not add private keys, account passwords, or other secrets to this repository. Do not deploy the public API for general use until an abuse-protection challenge and service monitoring are configured.
