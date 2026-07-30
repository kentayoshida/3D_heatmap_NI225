// Timeline animation: step the heatmap through the last N trading-day frames so
// it plays like a short clip. Each frame's footprint (area) is identical across
// frames (the backend pins it to a fixed weight), so bars stay in place while
// their height + color morph with each day's change% — a smooth, readable loop.
//
// Cadence: hold each frame 1s (static), morph to the next over 1s → 5 frames make
// a 9s clip (5×1s holds + 4×1s morphs). A bottom scrubber allows manual control.

const HOLD_MS = 1000;   // static dwell on each frame
const TWEEN_S = 1.0;    // frame-to-frame morph length (seconds)

// 90th-percentile |change%| across ALL frames → one shared vertical scale, so a
// given move looks the same height on any day of the clip.
function sharedCap(frames) {
  const all = [];
  for (const f of frames) for (const c of f.constituents) {
    const v = Math.abs(c.changePct);
    if (v > 0) all.push(v);
  }
  if (!all.length) return 3;
  all.sort((a, b) => a - b);
  return Math.max(all[Math.floor(all.length * 0.9)], 1.5);
}

// 'YYYY-MM-DD…' → 'MM/DD' for the compact date label.
function shortDate(asOf) {
  const d = String(asOf || '').slice(0, 10);
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}` : d;
}

export class Timeline {
  // `bar` is the buildTimelineBar handle; `onFrame(i, frame)` lets main sync other
  // chrome (e.g. the as-of line). `enterExit(active)` is called when the timeline
  // takes over / releases the display.
  constructor({ heatmap, bar, onFrame, enterExit }) {
    this.heatmap = heatmap;
    this.bar = bar;
    this.onFrame = onFrame;
    this.enterExit = enterExit;
    this.frames = [];
    this.cap = 3;
    this.index = 0;
    this.playing = false;
    this.entered = false;   // true while the timeline owns what's on screen
    this._timer = null;
  }

  // Swap in a new index's frames (or [] to disable). Parks the scrubber on the
  // LATEST frame so the bar reflects the most recent session on load (pressing
  // play restarts from the oldest). Playback still runs oldest → newest.
  setFrames(frames) {
    this.pause();
    this.frames = Array.isArray(frames) ? frames : [];
    this.cap = this.frames.length ? sharedCap(this.frames) : 3;
    this.index = Math.max(this.frames.length - 1, 0);
    const latest = this.frames[this.index];
    this.bar.setFrameCount(this.frames.length);
    this.bar.setEnabled(this.frames.length >= 2);
    this.bar.setFrame(this.index, latest ? shortDate(latest.asOf) : '');
  }

  hasFrames() { return this.frames.length >= 2; }
  isEntered() { return this.entered; }

  _show(i, animate) {
    i = Math.max(0, Math.min(this.frames.length - 1, i));
    this.index = i;
    const f = this.frames[i];
    if (!f) return;
    this.heatmap.setData(f.constituents, { animate, duration: TWEEN_S, cap: this.cap });
    this.bar.setFrame(i, shortDate(f.asOf));
    if (this.onFrame) this.onFrame(i, f);
  }

  _enter() {
    if (this.entered) return;
    this.entered = true;
    if (this.enterExit) this.enterExit(true);
  }

  // Called by main when the display leaves timeline control (period/index picked).
  exit() {
    this.pause();
    if (this.entered) {
      this.entered = false;
      if (this.enterExit) this.enterExit(false);
    }
  }

  toggle() {
    if (!this.hasFrames()) return;
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (!this.hasFrames()) return;
    this._enter();
    // restart from the top if we're sitting on the last frame
    if (this.index >= this.frames.length - 1) this._show(0, false);
    this.playing = true;
    this.bar.setPlaying(true);
    this._scheduleAdvance(HOLD_MS);
  }

  pause() {
    this.playing = false;
    clearTimeout(this._timer);
    this._timer = null;
    this.bar.setPlaying(false);
  }

  seek(i) {
    if (!this.frames.length) return;
    this._enter();
    this.pause();
    this._show(i, false);
  }

  _scheduleAdvance(delay) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (!this.playing) return;
      this._show(this.index + 1, true); // starts a 1s morph
      if (this.index >= this.frames.length - 1) {
        // last frame reached: let its morph + a final 1s hold play, then stop
        this._timer = setTimeout(() => { if (this.playing) this.pause(); }, TWEEN_S * 1000 + HOLD_MS);
        return;
      }
      this._scheduleAdvance(TWEEN_S * 1000 + HOLD_MS);
    }, delay);
  }
}
