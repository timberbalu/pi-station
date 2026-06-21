# pi-station — Ideas parking lot

> Future possibilities. Not committed. Not prioritised. Just captured so they don't get lost.
> Decisions already made are in diary.md and memory.md — not here.

---

## POST-BUILD ACTION (not optional — do this after J7)

**Rotate hardcoded credentials in apm `cc.php` and `ec.php`.**

- `cc.php` contains live `AWS_S3_ACCESS_KEY` + `AWS_S3_SECRET_KEY` in plaintext
- `ec.php` contains live `ELEVENLABS_API_KEY` in plaintext

Safe rotation steps documented in `devops/ai/diary.md` (J4 entry). Do this before the apm repo is ever made public or shared. Won't break live code if done correctly (create new creds first, add to EB env vars, update PHP to read from env, deploy, verify, then deactivate old creds).

---

## STRATEGIC INTENT — settled 2026-06-13

**The hackathon is a growth hacking technique, not a competition.** The goal is not to win prizes or use every sponsor technology. The goal is to build something that becomes a real, lasting part of ApresMeet and Foundry365. Raspberry Pi itself is the prize — getting it into the product stack is the win.

This means:
- Choose the **best technology for the product**, not the technology the hackathon recommends.
- Don't use sponsor tech (Vosk, NeuTTS, Ollama) unless it genuinely serves the roadmap better than the alternative.
- Build something **future-proof and production-quality**, not a hackathon prototype that gets thrown away.
- Every architectural decision should be one you'd make if building for production today.

---

## PRODUCT BOUNDARY — settled 2026-06-13

Pi-Station does three things, and does them with complete reliability:

1. **Audio** — WAV buffer, always, gapless, regardless of network
2. **Video** — local chunks, always, synced when connection allows
3. **Transcript** — Whisper STT, local, private, good enough to be useful

Everything beyond those three is the cloud's job.

- **CoCo** handles post-session AI intelligence (summarisation, insight extraction). Running Ollama on the Pi to duplicate this at 5 tokens/second would be a compromise, not a feature. Dropped from the roadmap.
- **MeetPaper / Media Desk** handle distribution, publishing, attendee delivery. The Pi doesn't publish.
- **ElevenLabs** is an optional quality upgrade — admin re-processes WAV through Scribe if they want higher-quality diarised transcript. The Pi doesn't make that decision.
- **NeuTTS** — not adding. TTS is not in scope; the Pi doesn't speak back to the room.

The Pi's job is to be physically present in the room and guarantee capture. The cloud's job is everything that benefits from real compute and connectivity. Don't muddy the boundary.

---

## Hardware ideas (future)

- **AI HAT+ / AI HAT+ 2 (Hailo NPU)** — Biju receives one by Thursday. 13 or 26 TOPS (original) or 40 TOPS (HAT+ 2). Auto-detected by Pi OS via PCIe Gen 3; `rpicam-apps` natively offloads vision inference to the NPU. For VideoComponent: real-time face detection, pose estimation, face-to-speaker mapping, slide detection — all on the NPU with zero CPU overhead. Models must be compiled to Hailo format on x86 first. Does NOT accelerate Whisper (CPU-bound). This is the upgrade that makes VideoComponent genuinely intelligent, not just raw capture.
- **Two-Pi production architecture** — Pi 1 (with AI HAT+): intelligent capture node — camera + audio + real-time NPU face detection during the session. Pi 2: processing node — Whisper post-session, SyncService, control API. Both units already available. Pi 1 handles the time-sensitive real-time work; Pi 2 handles the CPU-heavy post-session work without competing for the same resources. The production device is this pair.
- **NVMe SSD via Pi 5 PCIe slot** — 5× faster writes than microSD; no wear concern for production units recording multiple events per week. Note: if the AI HAT+ occupies the PCIe M.2 slot, an NVMe SSD would need a USB 3.0 enclosure instead.
- **USB-C UPS / power bank** — eliminates the only hardware single point of failure. ~£20. High priority before any production use.
- **Small OLED display** (SSD1306 via I2C) — recording state without needing a browser.
- **Physical start/stop button** — GPIO button for hosts who don't want to touch a laptop mid-session.
- **Multi-mic USB hub** — one lavalier per speaker for better diarisation.

## Software ideas (future, post-roadmap)

- **Bluetooth interaction component (J8+)** — BLE advertising + GATT server; attendee polls and feedback via ApresMeet PWA; presence detection. Fits the component model cleanly when ready.
- **Slide capture** — detect presentation slides in the video stream, timestamp them alongside transcript segments. Enriches the MeetPaper report with visual context.
- **Face-to-voice matching** — link speaker faces (video) to speaker labels (Whisper/Scribe diarisation). Improves speaker identification beyond audio alone.
- **WAV chunk re-submission** — after reconnect, re-submit offline WAV chunks to ElevenLabs for higher-quality transcription of the offline window. Complements the cloud upgrade path.
- **Highlight reel** — splice top insight-marked timestamps from the WAV buffer into a shareable audio clip. Pi prepares the raw material; CoCo selects and edits.
- **Station rental model** — ApresMeet provides pre-configured Pi units for a per-event fee. Registered to the organiser's account, locks to their VI subscription.
- **Privacy-first positioning** — "Audio and video never leave the room until you decide." Corporate and sensitive events will pay for this. The admin choice point (keep local Whisper or upgrade to ElevenLabs) makes the privacy guarantee tangible.
