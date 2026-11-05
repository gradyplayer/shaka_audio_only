// Shaka Player audio-only demo with a gapless video on/off switch.
//
// Shaka can't drop the video stream from a presentation that is already
// playing: `manifest.disableVideo` only takes effect when the manifest is
// parsed, and MSE can't remove a SourceBuffer mid-playback. Reloading the
// same element at the current time works but leaves a gap in the audio.
//
// To switch without a gap, the page uses two Shaka players:
//   - a "video" player attached to the <video> element (audio + video)
//   - an "audio" player attached to a hidden <audio> element (audio only)
//
// To switch, the idle player is loaded a few seconds ahead of the current
// position and buffered while paused. When the playing element reaches that
// point, the idle element starts, the two cross-fade for a moment, and the
// old player is unloaded so it stops downloading.

const MANIFEST_URL =
  'https://content.downlynk.com/2deba813936b4532b2b0057248c58352.mpd?rmt=wv';

// DRM: the stream is Widevine protected. This overrides any license URL
// found in the manifest.
const WIDEVINE_LICENSE_URL = 'https://content.downlynk.com/wv';

// How far ahead of the current position the idle player is prepared.
const LEAD_SECONDS = 4;
// Length of the cross-fade at the switch point.
const CROSSFADE_MS = 150;

const videoEl = document.getElementById('video');
const audioEl = document.getElementById('audio');
const toggleButton = document.getElementById('toggleVideo');
const playButton = document.getElementById('playPause');
const seekBar = document.getElementById('seek');
const timeEl = document.getElementById('time');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('audioOnlyOverlay');

const slots = {
  video: { name: 'video', el: videoEl, player: null, audioOnly: false },
  audio: { name: 'audio', el: audioEl, player: null, audioOnly: true },
};

let active = slots.video;
let switching = false;

// ---------------------------------------------------------------- helpers

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function formatKbps(bps) {
  return bps ? `${Math.round(bps / 1000)} kbps` : '-';
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function waitForEvent(el, name) {
  return new Promise((resolve) => el.addEventListener(name, resolve, { once: true }));
}

function waitForCanPlay(el) {
  if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    return Promise.resolve();
  }
  return waitForEvent(el, 'canplay');
}

// Resolves once `el` reaches `time`. Uses a short timer rather than
// requestAnimationFrame so it keeps working in a background tab.
function waitUntilTime(el, time) {
  return new Promise((resolve) => {
    const check = () => {
      if (el.currentTime >= time || el.paused || el.ended) {
        resolve();
      } else {
        setTimeout(check, 5);
      }
    };
    check();
  });
}

function crossfade(fromEl, toEl) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = () => {
      const t = Math.min((performance.now() - start) / CROSSFADE_MS, 1);
      fromEl.volume = 1 - t;
      toEl.volume = t;
      if (t < 1) {
        setTimeout(step, 10);
      } else {
        resolve();
      }
    };
    step();
  });
}

// ------------------------------------------------------------------- UI

function updateUi() {
  const el = active.el;
  playButton.textContent = el.paused ? 'Play' : 'Pause';
  playButton.disabled = switching;
  seekBar.disabled = switching;
  toggleButton.disabled = switching;
  toggleButton.textContent =
    active === slots.video ? 'Turn video off' : 'Turn video on';
  overlay.hidden = active === slots.video;

  if (isFinite(el.duration)) {
    seekBar.max = el.duration;
    if (!seekBar.matches(':active')) seekBar.value = el.currentTime;
  }
  timeEl.textContent = `${formatTime(el.currentTime)} / ${formatTime(el.duration)}`;
}

function updateInfo() {
  const player = active.player;
  const variant = player.getVariantTracks().find((t) => t.active);

  document.getElementById('infoMode').textContent =
    active === slots.video ? 'Audio + video' : 'Audio only';
  document.getElementById('infoElement').textContent = `<${active.el.tagName.toLowerCase()}>`;

  if (variant) {
    document.getElementById('infoAudio').textContent =
      `${variant.audioCodec || '-'} @ ${formatKbps(variant.audioBandwidth)}`;
    document.getElementById('infoVideo').textContent = variant.videoCodec
      ? `${variant.width}x${variant.height} ${variant.videoCodec} @ ` +
        formatKbps(variant.videoBandwidth)
      : 'none';
  }
  document.getElementById('infoBandwidth').textContent =
    formatKbps(player.getStats().streamBandwidth);
}

// --------------------------------------------------------------- players

async function createPlayer(slot) {
  const player = new shaka.Player();
  await player.attach(slot.el);
  player.configure({
    manifest: { disableVideo: slot.audioOnly },
    drm: { servers: { 'com.widevine.alpha': WIDEVINE_LICENSE_URL } },
  });

  player.addEventListener('error', (event) => onError(event.detail));
  player.addEventListener('variantchanged', () => slot === active && updateInfo());
  player.addEventListener('adaptation', () => slot === active && updateInfo());

  for (const name of ['timeupdate', 'play', 'pause', 'durationchange', 'ended']) {
    slot.el.addEventListener(name, () => slot === active && updateUi());
  }

  slot.player = player;
}

// Loads `slot` at `startTime` and waits until it has data to play.
async function prepare(slot, startTime) {
  slot.el.volume = 0;
  await slot.player.load(MANIFEST_URL, startTime);
  await waitForCanPlay(slot.el);
}

// Makes `to` the active slot and stops the old one downloading.
async function finishSwitch(from, to) {
  active = to;
  to.el.volume = 1;
  from.el.pause();
  updateUi();
  updateInfo();
  await from.player.unload();
  from.el.volume = 1;
}

async function switchTo(to) {
  const from = active;
  const wasPlaying = !from.el.paused && !from.el.ended;

  if (!wasPlaying) {
    // Nothing is audible, so a plain load at the current position is fine.
    await prepare(to, from.el.currentTime);
    await finishSwitch(from, to);
    return;
  }

  // Buffer the idle player at a point slightly in the future. If loading
  // took longer than the lead time, seek it further ahead and try again.
  let target = from.el.currentTime + LEAD_SECONDS;
  await prepare(to, target);
  for (let attempt = 0; from.el.currentTime > target - 0.25; attempt++) {
    if (attempt >= 3) throw new Error('Could not buffer ahead of playback');
    target = from.el.currentTime + LEAD_SECONDS;
    to.el.currentTime = target;
    await waitForEvent(to.el, 'seeked');
    await waitForCanPlay(to.el);
  }

  // Start the new element exactly when the old one reaches the target.
  await waitUntilTime(from.el, target);
  if (from.el.paused || from.el.ended) {
    // The user paused (or playback ended) while we were waiting.
    to.el.currentTime = from.el.currentTime;
    await finishSwitch(from, to);
    return;
  }
  await to.el.play();
  await crossfade(from.el, to.el);
  await finishSwitch(from, to);
}

async function toggleVideo() {
  const to = active === slots.video ? slots.audio : slots.video;
  switching = true;
  updateUi();
  setStatus(to === slots.video ? 'Turning video on…' : 'Turning video off…');

  try {
    await switchTo(to);
    setStatus(to === slots.video ? 'Video on' : 'Video off, audio only');
  } catch (error) {
    // Keep playing on the original element.
    to.el.pause();
    to.player.unload();
    onError(error);
  } finally {
    switching = false;
    updateUi();
  }
}

function onError(error) {
  const detail = error && error.code ? `Shaka error ${error.code}` : error;
  console.error('Player error', error);
  setStatus(`Error: ${detail}`, true);
}

// ------------------------------------------------------------------ init

async function init() {
  document.getElementById('manifestUrl').textContent = MANIFEST_URL;

  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) {
    setStatus('This browser is not supported by Shaka Player.', true);
    return;
  }

  await createPlayer(slots.video);
  await createPlayer(slots.audio);

  playButton.addEventListener('click', () => {
    if (active.el.paused) {
      active.el.play().catch(onError);
    } else {
      active.el.pause();
    }
  });
  seekBar.addEventListener('input', () => {
    active.el.currentTime = Number(seekBar.value);
  });
  toggleButton.addEventListener('click', toggleVideo);

  try {
    // Start with video on.
    await slots.video.player.load(MANIFEST_URL, 0);
    slots.video.el.volume = 1;
    updateInfo();
    updateUi();
    setStatus('Ready. Press play.');
  } catch (error) {
    onError(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
