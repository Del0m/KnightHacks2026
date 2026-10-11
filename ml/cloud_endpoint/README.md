# cloud_endpoint (CONN-11)

Cloud pose mode for phones that can't run YOLOv8n-pose on-device (Android, slow iPhones; Architecture §4.1).

```
phone ──WebSocket──▶ SteadyForum API /pose/stream ──HTTPS, one frame per request──▶ HF Inference Endpoint (handler.py)
      ◀── pose JSON ──                         ◀── pose result contract ──
```

- **`handler.py`**: Hugging Face custom handler. YOLOv8n-pose on each frame, returns the [pose result contract](../../docs/pose/pose-result-contract.md) (`source: "cloud"`), or `null` when no person is found.
- **The WebSocket lives in the API** (`apps/api/src/routes/poseStream.ts`), not on the endpoint. That keeps the HF token on the server (§14), and HF custom handlers only do request/response; WebSockets on the endpoint itself would need a custom Docker container, which HF doesn't document as supported.
- **Frames are never stored.** The phone sends them, the API holds the newest one in memory until the endpoint answers, and the handler decodes it in memory and drops it. Nothing is written to disk or logged.

## Test locally

```bash
cd ml/pose_export && uv run --with pytest python -m pytest ../cloud_endpoint/tests   # 8 tests, CPU
```

On an Apple-silicon Mac a 320 px frame (~23 KB JPEG) takes about **10 ms** (median, p95 11 ms) on CPU.

## Deploy

1. **Model repo:** create a private model repo, e.g. `bubblesmal/steadyforum-pose-endpoint`, and upload `handler.py` and `requirements.txt` (optionally `yolov8n-pose.pt`, otherwise the handler downloads it on start):
   ```bash
   hf upload bubblesmal/steadyforum-pose-endpoint ml/cloud_endpoint/handler.py handler.py --private
   hf upload bubblesmal/steadyforum-pose-endpoint ml/cloud_endpoint/requirements.txt requirements.txt
   ```
2. **Endpoint:** [Inference Endpoints](https://endpoints.huggingface.co) → New → that repo. The task shows as **Custom** because of `handler.py`.
   - Instance: start with **CPU · intel-spr x4**, move to **GPU · nvidia-t4 x1** if frames take too long (see Cost).
   - Security: **Protected** (needs an HF token).
   - Autoscaling: min replicas **0**, **scale to zero after 15 min** idle.
3. **API:** set `POSE_ENDPOINT_URL` (the endpoint URL) in `apps/api/.env`. `HF_TOKEN` must be allowed to call your Inference Endpoints. Restart the API; the startup log shows `cloudPose: true`.
4. **Check it:** `curl -X POST "$POSE_ENDPOINT_URL" -H "Authorization: Bearer $HF_TOKEN" -H "Content-Type: application/json" -d "{\"inputs\": \"$(base64 -i frame.jpg)\"}"`

If the endpoint crashes on start importing `cv2`, the image has GUI OpenCV from Ultralytics' dependencies; `requirements.txt` adds the headless build for that reason.

## Cost

Billed per minute while the endpoint is initializing or running; scaled to zero it doesn't run ([HF pricing](https://huggingface.co/docs/inference-endpoints/en/pricing)).

| Instance | Price | 45-min workout + 15 min idle tail | 4-hour demo |
|---|---|---|---|
| CPU intel-spr x4 (4 vCPU) | $0.134/h | ~$0.13 | ~$0.54 |
| CPU intel-spr x2 (2 vCPU) | $0.067/h | ~$0.07 | ~$0.27 |
| GPU nvidia-t4 x1 | $0.50/h | ~$0.50 | ~$2.00 |

The budget is ~150–300 ms per round trip (§4.1). YOLOv8n-pose at 320 px is small enough that CPU may fit; x86 server CPUs are slower than the Mac above, so measure `endpoint_ms` in the API's replies before choosing. At 10 fps a CPU replica handles one or two lifters; the API's newest-frame-only relay keeps a slow endpoint from building a backlog either way.

**Cold start:** waking from zero takes a few minutes and the HF proxy answers 503 meanwhile. The API turns that into `{"type":"status","status":"warming"}` and backs off, and the app shows its quiet "reconnecting" state. Warm it up before a demo by sending one frame.

## Protocol for the app

See the header of `apps/api/src/routes/poseStream.ts`. In short:

- Connect to `wss://<api>/pose/stream` with `Authorization: Bearer <Neon Auth token>` (or `?token=`).
- Send one binary message per frame: 8-byte big-endian float64 `timestamp_ms`, then the JPEG (~320 px, upright, unmirrored, about 10 fps).
- Receive JSON: `ready`, `pose` (`result` is the pose result contract or `null`, plus `latency_ms`, `endpoint_ms`, `dropped`), `status: warming`, `error`.
