const soundKey = 'shiv-owner-sound';
/** Whether the desk plays the new-work bell (on unless switched off on this device). */
export function soundOn() {
  try {
    return localStorage.getItem(soundKey) !== 'off';
  } catch {
    return true;
  }
}

/** A short tone made here, so there is no sound file to load. A browser may refuse it. */
export function ringBell() {
  try {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const volume = context.createGain();
    tone.frequency.value = 880;
    volume.gain.setValueAtTime(0.2, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
    tone.connect(volume).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.4);
    tone.onended = () => void context.close();
  } catch {
    /* No sound is not worth an error. */
  }
}
