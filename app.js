// Shaka Player audio-only demo.
//
// The page starts in audio-only mode: Shaka is configured with
// `manifest.disableVideo = true`, so the parser drops the video
// AdaptationSets and only audio segments are fetched.
//
// Shaka applies `disableVideo` when it parses the manifest, and MSE does not
// allow adding or removing a SourceBuffer mid-playback. Toggling video
// therefore reloads the manifest at the current playback position.

const MANIFEST_URL =
  'https://content.downlynk.com/2deba813936b4532b2b0057248c58352.mpd?rmt=wv';

// DRM: the stream is Widevine protected. This overrides any license URL
// found in the manifest.
const WIDEVINE_LICENSE_URL = 'https://content.downlynk.com/wv';

const video = document.getElementById('video');
const toggleButton = document.getElementById('toggleVideo');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('audioOnlyOverlay');

let player;
let videoEnabled = false;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function formatKbps(bps) {
  return bps ? `${Math.round(bps / 1000)} kbps` : '-';
}

function updateInfo() {
  const active = player.getVariantTracks().find((t) => t.active);
  document.getElementById('infoMode').textContent =
    videoEnabled ? 'Audio + video' : 'Audio only';

  if (active) {
    document.getElementById('infoAudio').textContent =
      `${active.audioCodec || '-'} @ ${formatKbps(active.audioBandwidth)}`;
    document.getElementById('infoVideo').textContent = active.videoCodec
      ? `${active.width}x${active.height} ${active.videoCodec} @ ` +
        formatKbps(active.videoBandwidth)
      : 'none';
  }
  document.getElementById('infoBandwidth').textContent =
    formatKbps(player.getStats().streamBandwidth);

  toggleButton.textContent = videoEnabled ? 'Turn video off' : 'Turn video on';
  overlay.hidden = videoEnabled;
}

async function load(startTime) {
  player.configure('manifest.disableVideo', !videoEnabled);
  await player.load(MANIFEST_URL, startTime);
  updateInfo();
}

async function toggleVideo() {
  const position = video.currentTime;
  const wasPlaying = !video.paused && !video.ended;

  toggleButton.disabled = true;
  videoEnabled = !videoEnabled;
  setStatus(videoEnabled ? 'Enabling video…' : 'Disabling video…');

  try {
    await load(position);
    if (wasPlaying) {
      await video.play();
    }
    setStatus('Ready');
  } catch (error) {
    // Roll back the flag so the UI matches what is actually playing.
    videoEnabled = !videoEnabled;
    onError(error);
  } finally {
    toggleButton.disabled = false;
  }
}

function onError(error) {
  const detail = error && error.code ? `Shaka error ${error.code}` : error;
  console.error('Player error', error);
  setStatus(`Error: ${detail}`, true);
}

async function init() {
  document.getElementById('manifestUrl').textContent = MANIFEST_URL;

  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) {
    setStatus('This browser is not supported by Shaka Player.', true);
    return;
  }

  player = new shaka.Player();
  await player.attach(video);

  player.configure({
    drm: {
      servers: {
        'com.widevine.alpha': WIDEVINE_LICENSE_URL,
      },
    },
  });

  player.addEventListener('error', (event) => onError(event.detail));
  player.addEventListener('variantchanged', updateInfo);
  player.addEventListener('adaptation', updateInfo);

  toggleButton.addEventListener('click', toggleVideo);

  try {
    await load(0);
    setStatus('Ready. Press play.');
    toggleButton.disabled = false;
  } catch (error) {
    onError(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
