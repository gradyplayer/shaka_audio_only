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

- Audio-only mode uses `manifest.disableVideo: true`. Shaka drops the video
  AdaptationSets while parsing, so only the ~34 kbps audio stream is
  downloaded instead of up to ~2.3 Mbps of video.
- Playback starts with video on.
- Shaka can't drop video from a presentation that is already playing, so
  the page uses two players: one on the `<video>` element (audio + video)
  and one on a hidden `<audio>` element (audio only, `disableVideo: true`).
- To switch, the idle player is loaded 4 s ahead of the current position and
  buffered while paused. When the playing element reaches that point, the
  idle one starts, the two cross-fade for 150 ms, and the old player is
  unloaded so it stops downloading. Turning video back on uses the same
  steps in reverse.
- The page has its own play/pause and seek controls, because the native
  `<video>` controls can't drive the `<audio>` element.
- The manifest is requested with `?rmt=wv`, and Widevine licenses come from
  `https://content.downlynk.com/wv`, set through
  `drm.servers['com.widevine.alpha']`.
