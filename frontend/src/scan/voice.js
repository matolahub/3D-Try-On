// Live Body Scan – guida vocale (Web Speech API, voce italiana del sistema) e segnali sonori (Web Audio).
// A 2 metri lo schermo non si legge: ogni istruzione importante viene detta. Regole per non parlare in continuazione:
//   - un'istruzione nuova si dice appena la voce e' libera (le conferme di fase hanno la precedenza e interrompono);
//   - la stessa istruzione si ripete solo dopo `repeatMs`;
//   - un'istruzione deve restare valida per `settleMs` prima di essere detta (niente frasi per un fotogramma rumoroso).

export function createVoice({ repeatMs = 6000, settleMs = 450 } = {}) {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  let enabled = !!synth, voice = null, audio = null;
  let last = { text: null, at: -1e9 }, pending = null;

  const pickVoice = () => {
    const vs = synth?.getVoices?.() ?? [];
    voice = vs.find((v) => v.lang?.toLowerCase().startsWith("it") && v.localService) || vs.find((v) => v.lang?.toLowerCase().startsWith("it")) || null;
  };
  if (synth) { pickVoice(); synth.addEventListener?.("voiceschanged", pickVoice); }

  function say(text, { urgent = false } = {}) {
    if (!enabled || !synth || !text) return;
    if (urgent) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "it-IT";
    if (voice) u.voice = voice;
    u.rate = 1.05;
    synth.speak(u);
    last = { text, at: performance.now() };
  }

  /** Da chiamare a ogni aggiornamento con l'istruzione corrente. */
  function update(text, { urgent = false } = {}) {
    const now = performance.now();
    if (!text) { pending = null; return; }
    if (urgent) { if (text !== last.text || now - last.at > 1500) say(text, { urgent: true }); pending = null; return; }
    if (!pending || pending.text !== text) pending = { text, since: now };
    if (now - pending.since < settleMs) return;
    if (synth?.speaking) return;
    if (text === last.text && now - last.at < repeatMs) return;
    say(text);
  }

  function tone(freqs, dur = 0.11, gap = 0.04) {
    if (!enabled) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      let t = audio.currentTime + 0.01;
      for (const f of freqs) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t + dur + 0.02);
        t += dur + gap;
      }
    } catch { /* audio non disponibile */ }
  }

  return {
    update,
    say,
    /** Sblocca audio e voce: va chiamata dentro un gesto dell'utente (tap), soprattutto su iOS. */
    unlock() {
      try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* */ }
      if (synth) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); }
    },
    beepStep: () => tone([660, 880]),
    beepDone: () => tone([660, 880, 1175], 0.13),
    beepWarn: () => tone([330], 0.15),
    setEnabled(on) { enabled = on && !!(synth || window.AudioContext); if (!on) synth?.cancel(); },
    get enabled() { return enabled; },
    get available() { return !!synth; },
    dispose() { synth?.cancel(); synth?.removeEventListener?.("voiceschanged", pickVoice); audio?.close?.(); },
  };
}
