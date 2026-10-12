// ==========================================================================
// REFLEXRUN 3D - DYNAMIC WORKOUT AUDIO & SYNTH ENGINE
// ==========================================================================

export class SoundManager {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isPlayingMusic = false;
    this.bpm = 128;
    this.currentStep = 0;
    this.timerId = null;
    this.speechEnabled = 'speechSynthesis' in window;
    this.lastVoiceTime = 0;
  }

  init() {
    if (this.ctx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContext();

    // Master bus
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // Music bus
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.setValueAtTime(0.55, this.ctx.currentTime);
    this.musicGain.connect(this.masterGain);

    // SFX bus
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.setValueAtTime(0.9, this.ctx.currentTime);
    this.sfxGain.connect(this.masterGain);
  }

  ensureContext() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
    }
    return !this.isMuted;
  }

  setBpm(bpm) {
    this.bpm = Math.max(120, Math.min(160, bpm));
  }

  // --------------------------------------------------------------------------
  // MUSIC SYNTHESIZER: DYNAMIC WORKOUT BEAT LOOP
  // --------------------------------------------------------------------------
  startMusic() {
    this.ensureContext();
    if (this.isPlayingMusic) return;
    this.isPlayingMusic = true;
    this.currentStep = 0;
    this.scheduleNextBeat();
  }

  stopMusic() {
    this.isPlayingMusic = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  scheduleNextBeat() {
    if (!this.isPlayingMusic || !this.ctx) return;

    const stepInterval = (60 / this.bpm) / 4; // 16th note step
    const time = this.ctx.currentTime + 0.05;

    // 16-step patterns
    const step = this.currentStep % 16;

    // Kick on 0, 4, 8, 12 (4-on-the-floor)
    if (step % 4 === 0) {
      this.playKick(time);
    }

    // Snare / Clap on 4, 12
    if (step === 4 || step === 12) {
      this.playSnare(time);
    }

    // Hi-Hats: closed on even steps, open on off-beats (step 2, 6, 10, 14)
    if (step % 2 === 0) {
      const isOpen = (step % 4 === 2);
      this.playHiHat(time, isOpen);
    }

    // Bassline groove (Driving syncopated synth bass)
    const bassNotes = [55, 55, 65.41, 55, 55, 73.42, 55, 49]; // A1, C2, D2, G1
    if (step % 2 === 0) {
      const noteIdx = Math.floor(step / 2) % bassNotes.length;
      this.playBassNote(time, bassNotes[noteIdx]);
    }

    this.currentStep++;
    this.timerId = setTimeout(() => this.scheduleNextBeat(), stepInterval * 1000);
  }

  playKick(time) {
    if (this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.08);

    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    osc.connect(gain);
    gain.connect(this.musicGain);

    osc.start(time);
    osc.stop(time + 0.25);
  }

  playSnare(time) {
    if (this.isMuted) return;
    // Tone body
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.08);
    oscGain.gain.setValueAtTime(0.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.12);
    osc.connect(oscGain);
    oscGain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.15);

    // Noise snap
    const bufferSize = this.ctx.sampleRate * 0.15;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.04));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1000, time);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.musicGain);

    noise.start(time);
    noise.stop(time + 0.15);
  }

  playHiHat(time, isOpen = false) {
    if (this.isMuted) return;
    const dur = isOpen ? 0.14 : 0.04;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(8500, time);
    filter.Q.setValueAtTime(3.0, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(isOpen ? 0.35 : 0.2, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    noise.start(time);
    noise.stop(time + dur);
  }

  playBassNote(time, freq) {
    if (this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, time);
    filter.frequency.exponentialRampToValueAtTime(120, time + 0.18);

    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    osc.start(time);
    osc.stop(time + 0.22);
  }

  // --------------------------------------------------------------------------
  // GAMEPLAY SOUND EFFECTS (SFX)
  // --------------------------------------------------------------------------

  playPunchImpact() {
    this.ensureContext();
    if (this.isMuted || !this.ctx) return;
    const time = this.ctx.currentTime;

    // Heavy punch sub-thump
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(180, time);
    subOsc.frequency.exponentialRampToValueAtTime(32, time + 0.15);
    subGain.gain.setValueAtTime(1.2, time);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    subOsc.connect(subGain);
    subGain.connect(this.sfxGain);
    subOsc.start(time);
    subOsc.stop(time + 0.28);

    // Punch transient crack
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.015));
    }
    const snap = this.ctx.createBufferSource();
    snap.buffer = buffer;
    const snapGain = this.ctx.createGain();
    snapGain.gain.setValueAtTime(0.7, time);
    snapGain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
    snap.connect(snapGain);
    snapGain.connect(this.sfxGain);
    snap.start(time);
  }

  playMonsterShatter() {
    this.ensureContext();
    if (this.isMuted || !this.ctx) return;
    const time = this.ctx.currentTime;

    // Massive crunch & rock explosion
    const dur = 0.45;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(700, time);
    filter.frequency.exponentialRampToValueAtTime(200, time + dur);
    filter.Q.setValueAtTime(2.0, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    noise.start(time);
  }

  playJumpWhoosh() {
    this.ensureContext();
    if (this.isMuted || !this.ctx) return;
    const time = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(550, time + 0.18);

    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.22);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  playSlideScrape() {
    this.ensureContext();
    if (this.isMuted || !this.ctx) return;
    const time = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, time);
    osc.frequency.linearRampToValueAtTime(65, time + 0.25);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, time);

    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(time);
    osc.stop(time + 0.32);
  }

  playDamage() {
    this.ensureContext();
    if (this.isMuted || !this.ctx) return;
    const time = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.3);

    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.35);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(time);
    osc.stop(time + 0.38);
  }

  playComboChime(multiplier = 1) {
    this.ensureContext();
    if (this.isMuted || !this.ctx) return;
    const time = this.ctx.currentTime;

    const pentatonic = [523.25, 659.25, 783.99, 987.77, 1046.5]; // C5, E5, G5, B5, C6
    const note = pentatonic[Math.min(multiplier - 1, pentatonic.length - 1)] || 880;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note, time);

    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(time);
    osc.stop(time + 0.45);
  }

  // Coach Voice Prompts
  speakPrompt(text) {
    if (this.isMuted || !this.speechEnabled) return;
    const now = Date.now();
    // Prevent voice clutter
    if (now - this.lastVoiceTime < 1400) return;
    this.lastVoiceTime = now;

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.35;
      utter.pitch = 1.1;
      utter.volume = 0.85;
      window.speechSynthesis.speak(utter);
    } catch (e) {
      // Ignore if blocked by browser policy
    }
  }
}
