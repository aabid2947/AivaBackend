# Audio Streaming Debug Guide

## Current Issue
Audio streaming pipeline executes successfully but produces **silent audio** on Twilio calls.

## What's Been Fixed
✅ ChatGPT client created (gpt-4o-mini model)
✅ Twilio service switched from Gemini to ChatGPT
✅ ElevenLabs SDK updated (`convertAsStream` method)
✅ FFmpeg async iterator handling implemented
✅ WebSocket protocol fixed (wss:// via trust proxy)
✅ **Extensive logging added throughout entire pipeline**

## Logging Added - What to Look For

### 1. ElevenLabs TTS Request (`elevenLabsStreamClient.js`)
```
[ELEVENLABS] ========== Starting TTS Request ==========
[ELEVENLABS] Text: "<text preview>"
[ELEVENLABS] Text length: X characters
[ELEVENLABS] Voice ID: 21m00Tcm4TlvDq8ikWAM
[ELEVENLABS] Model: eleven_turbo_v2
[ELEVENLABS] Stream received successfully
[ELEVENLABS] Stream type: <constructor name>
[ELEVENLABS] Stream is an async iterator
```

**What to verify:**
- ✅ Request completes without errors
- ✅ Stream is received (not null)
- ✅ Stream is an async iterator (expected type)

### 2. Audio Streaming Start (`twilioCallServer.js`)
```
[TTS] ========== Starting stream X ==========
[TTS] Text to synthesize: "<text>"
[TTS] Text length: X characters
[TTS] Step 1: Calling ElevenLabs API...
[TTS] Step 1 complete: ElevenLabs stream received
[TTS] Stream type: <constructor name>
```

**What to verify:**
- ✅ Stream ID increments for each request
- ✅ ElevenLabs API call succeeds
- ✅ Stream type is correct

### 3. FFmpeg Transcoding (`transcodeMp3ToMulaw`)
```
[TRANSCODE] ========== Starting Transcoding ==========
[TRANSCODE] Input stream type: <constructor name>
[TRANSCODE] Stream is async iterator: true/false
[TRANSCODE] Converting async iterator to PassThrough stream...
[TRANSCODE] PassThrough stream created
[TRANSCODE] Starting async iteration...
[TRANSCODE] Chunk 1: Y bytes (total: Y bytes)
[TRANSCODE] Chunk 2: Y bytes (total: Y bytes)
[TRANSCODE] Chunk 3: Y bytes (total: Y bytes)
[TRANSCODE] FFmpeg: <stderr output>
[TRANSCODE] Output chunk: Y bytes (total: Y bytes)
[TRANSCODE] ========== Transcoding Complete ==========
[TRANSCODE] Total input bytes: Y
[TRANSCODE] Total chunks received: X
[TRANSCODE] Total output bytes: Y
```

**What to verify:**
- ✅ Input chunks are being received (bytes > 0)
- ✅ FFmpeg is processing (stderr shows encoding info)
- ✅ Output chunks are being produced (bytes > 0)
- ⚠️ **CRITICAL: Compare input bytes vs output bytes**
  - If input > 0 but output = 0 → FFmpeg is not producing output
  - If both > 0 but audio silent → Check Twilio transmission

### 4. Twilio WebSocket Transmission
```
[TTS] Step 3: Starting transmission to Twilio WebSocket...
[TTS] WebSocket state: 1 (1=OPEN)
[TTS] Sending chunk 1: Y bytes (total: Y bytes)
[TTS] First 20 bytes (hex): <hex data>
[TTS] Base64 payload length: Y
[TTS] Progress: 50 chunks, Y bytes sent...
[TTS] ========== Stream X COMPLETE ==========
[TTS] Total chunks sent: X
[TTS] Total bytes sent: Y
[TTS] Sending completion mark: stream-X-complete
```

**What to verify:**
- ✅ WebSocket is OPEN (state = 1)
- ✅ Chunks are being sent (count > 0, bytes > 0)
- ⚠️ **CRITICAL: Check hex data is not all zeros**
  - If hex shows `00 00 00 00...` → Audio data is silent/empty
  - If hex shows varied bytes → Audio data exists, problem is elsewhere

## Diagnostic Scenarios

### Scenario A: No ElevenLabs chunks received
**Symptoms:**
```
[TRANSCODE] Total chunks received: 0
[TRANSCODE] Total input bytes: 0
```
**Diagnosis:** ElevenLabs API not returning audio data
**Actions:**
1. Check ELEVENLABS_API_KEY is valid
2. Check API quota/limits
3. Test with simple text like "Hello world"

### Scenario B: ElevenLabs OK, No FFmpeg output
**Symptoms:**
```
[TRANSCODE] Total input bytes: 150000  ✅
[TRANSCODE] Total output bytes: 0      ❌
```
**Diagnosis:** FFmpeg is not transcoding properly
**Actions:**
1. Check FFmpeg stderr output for errors
2. Verify FFmpeg input format detection
3. Test FFmpeg command separately

### Scenario C: FFmpeg OK, No Twilio transmission
**Symptoms:**
```
[TRANSCODE] Total output bytes: 50000  ✅
[TTS] Total chunks sent: 0              ❌
```
**Diagnosis:** WebSocket or stream issue
**Actions:**
1. Check WebSocket state (should be 1 = OPEN)
2. Verify stream event handlers are firing
3. Check for stream cancellation

### Scenario D: All bytes OK, but silent audio
**Symptoms:**
```
[TRANSCODE] Total output bytes: 50000  ✅
[TTS] Total chunks sent: 200           ✅
[TTS] Total bytes sent: 50000          ✅
[TTS] First 20 bytes (hex): 00 00 00 00 00 00...  ⚠️
```
**Diagnosis:** Audio data is empty/silent at source
**Actions:**
1. Check hex output - should show varied bytes
2. Test ElevenLabs directly (skip FFmpeg)
3. Verify voice settings in ElevenLabs request

### Scenario E: All looks good but still silent
**Symptoms:**
```
All logs show success
Hex data shows varied bytes
But call is still silent
```
**Diagnosis:** Twilio encoding mismatch or rate issue
**Actions:**
1. Verify μ-law encoding (should be 8-bit, 8kHz, mono)
2. Check Twilio expects base64 payload
3. Test with known-good audio file

## Next Steps

1. **Run a test call** and capture the full log output
2. **Look for these critical values:**
   - ElevenLabs input chunks: Should be > 0
   - FFmpeg output bytes: Should be > 0
   - Twilio chunks sent: Should be > 0
   - Hex data: Should NOT be all zeros
3. **Match your logs to the scenarios above**
4. **Share the logs** focusing on:
   - `[ELEVENLABS]` lines
   - `[TRANSCODE]` lines (especially totals)
   - `[TTS]` lines (especially hex data and totals)

## Environment Variables Required

Make sure these are set:
```bash
OPENAI_API_KEY=sk-proj-l1iifhSxzFc9auormy2S...
ELEVENLABS_API_KEY=<your-key>
```

## Quick Test Command

```bash
# Start server
npm start

# Make test call through Twilio
# Watch console for the logs above
```

## Expected Successful Log Pattern

```
[ELEVENLABS] ========== Starting TTS Request ==========
[ELEVENLABS] Stream received successfully
[TRANSCODE] ========== Starting Transcoding ==========
[TRANSCODE] Chunk 1: 4096 bytes (total: 4096 bytes)
[TRANSCODE] Chunk 2: 4096 bytes (total: 8192 bytes)
... more chunks ...
[TRANSCODE] Output chunk: 2048 bytes (total: 2048 bytes)
[TRANSCODE] Output chunk: 2048 bytes (total: 4096 bytes)
... more output chunks ...
[TTS] Sending chunk 1: 640 bytes (total: 640 bytes)
[TTS] First 20 bytes (hex): 7f 5a 3c 2e ff a4 b8 c2 ...  ← NOT all zeros!
[TTS] Total chunks sent: 100
[TTS] Total bytes sent: 64000
```

If your logs match this pattern but audio is still silent, the issue is likely:
- Twilio codec/format mismatch
- Client-side playback issue
- Network/streaming interruption
