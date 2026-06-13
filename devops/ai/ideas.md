# pi-station — Ideas parking lot

> Future possibilities. Not committed. Not prioritised. Just captured so they don't get lost.

---

## Hardware expansions

- **Multi-mic mixing via USB hub** — one lavalier per speaker, mixed on the Pi before streaming to ElevenLabs. Better diarisation for panel sessions.
- **Small OLED display** (SSD1306 via I2C) — show recording state, queue depth, WS status without needing a browser. Visible at a glance on the venue table.
- **Physical start/stop button** — GPIO button on the Pi to start/stop recording without touching the browser. Useful when the host doesn't want to touch a laptop mid-session.
- **USB-C UPS integration** — detect power bank battery level via USB PD and surface it in `/status`. Alert the Live Desk when battery is low.

## Software expansions

- **ElevenLabs TTS post-processing** — after session ends, send the AI summary through ElevenLabs TTS to generate an audio summary clip for the Media Desk episode.
- **Highlight reel** — splice the top 3-5 approved pull quote timestamps from the WAV buffer into a short shareable audio clip.
- **Local Kaa node** — run a small LLM (llama3.2:3b via Ollama) alongside pi-station to do local-first classification of transcript segments before they're posted. Opportunity detection without cloud dependency.
- **Mac dev audio mock** — `src/capture-mock.ts` substituting arecord with `ffmpeg`/`sox` for local development. Selectable via `AUDIO_DEVICE=mock` env.

## Product ideas

- **MeetPaper Station as a product** — organisers buy or rent a pre-configured Pi. Pairs with any session via a 6-digit code. Sits in a bag until needed. Could ship as a product bundle with a recommended USB mic.
- **Station rental model** — ApresMeet provides hardware for a fee per event. The Pi is registered to the organiser's account, locks to their VI subscription.
- **Event presence beacon** — combine Station with BLE advertising so attendees with the ApresMeet PWA auto-check in when they enter the room. One device, three functions: audio capture + Kaa intelligence + presence detection.
