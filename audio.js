/* 合成音效 — Web Audio API 即時生成，無音檔。
   引擎聲（低頻隆隆 + 風切噪音）音量與音高隨列車速度連續變化。 */

const SFX = (() => {
  let ctx = null;
  let master = null;
  let engine = null;
  let muted = localStorage.getItem("stationTyper.muted") === "1";

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      buildEngine();
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  function buildEngine() {
    // 車體低鳴
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 42;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0;
    osc.connect(oscGain).connect(master);
    osc.start();

    // 風切 / 軌道滾動：白噪音 + 帶通濾波
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 350;
    filter.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(filter).connect(noiseGain).connect(master);
    noise.start();

    engine = { osc, oscGain, filter, noiseGain };
  }

  // speed: 0～3（遊戲的 playbackRate）
  function setSpeed(speed) {
    if (!ctx || !engine) return;
    const t = ctx.currentTime;
    const k = Math.max(0, Math.min(speed / 3, 1));
    engine.oscGain.gain.setTargetAtTime(k * 0.1, t, 0.15);
    engine.osc.frequency.setTargetAtTime(40 + k * 52, t, 0.2);
    engine.noiseGain.gain.setTargetAtTime(k * k * 0.09, t, 0.15);
    engine.filter.frequency.setTargetAtTime(300 + k * 1300, t, 0.2);
  }

  function blip(freq, dur, { type = "sine", gain = 0.08, when = 0, slide = 0 } = {}) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(freq + slide, 30), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  return {
    unlock: ensure,
    setSpeed,
    // 正確擊鍵：短滴答，音高隨連擊微升
    tick(combo) {
      blip(1800 + Math.min(combo, 60) * 9 + Math.random() * 50, 0.045, { type: "triangle", gain: 0.045 });
    },
    // 打錯：低鳴下滑
    error() { blip(140, 0.16, { type: "sawtooth", gain: 0.08, slide: -70 }); },
    // 進站叮咚（雙音下行）
    chime() {
      blip(1319, 0.3, { gain: 0.1 });
      blip(1047, 0.34, { gain: 0.1, when: 0.15 });
    },
    // 連擊里程碑：上行琶音
    comboUp() { [523, 659, 784].forEach((f, i) => blip(f, 0.1, { type: "triangle", gain: 0.06, when: i * 0.055 })); },
    // 倒數嗶聲
    count(isGo) { blip(isGo ? 990 : 660, isGo ? 0.3 : 0.12, { type: "triangle", gain: 0.11 }); },
    // 單人抵達終點：三音鐘聲
    terminal() { [1319, 1047, 784].forEach((f, i) => blip(f, 0.42, { gain: 0.09, when: i * 0.18 })); },
    // 對戰勝利：小號角
    win() { [523, 659, 784, 1047].forEach((f, i) => blip(f, i === 3 ? 0.5 : 0.14, { type: "triangle", gain: 0.1, when: i * 0.12 })); },
    // 對戰敗北：下行小調
    lose() { [330, 262, 220].forEach((f, i) => blip(f, 0.32, { type: "triangle", gain: 0.08, when: i * 0.17 })); },
    toggle() {
      muted = !muted;
      localStorage.setItem("stationTyper.muted", muted ? "1" : "0");
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
      return muted;
    },
    get muted() { return muted; },
  };
})();
