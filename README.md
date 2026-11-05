# Shaka Player audio-only demo

A static page that plays only the audio of a DASH manifest with
[Shaka Player](https://github.com/shaka-project/shaka-player) 5.3.3, plus a
button that turns video on and off while audio keeps playing.

## Run

The stream uses DRM (Widevine / PlayReady), and browsers only expose EME on
secure origins, so serve the page from `localhost` (or HTTPS) rather than
opening `index.html` as a file:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## How it works

- Audio-only mode sets `manifest.disableVideo: true`. Shaka drops the video
  AdaptationSets while parsing, so only the ~34 kbps audio stream is
  downloaded instead of up to ~2.3 Mbps of video.
- The toggle flips `manifest.disableVideo` and calls
  `player.load(url, currentTime)`. A reload is required because Shaka applies
  the setting at parse time and MSE can't add a video SourceBuffer once
  playback has started. Expect a short pause in audio at the switch.
- The manifest is requested with `?rmt=wv`, and Widevine licenses come from
  `https://content.downlynk.com/wv`, set through
  `drm.servers['com.widevine.alpha']`.
