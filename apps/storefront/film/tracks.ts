// The film as data. Numbers are hundredths of a screen scrolled. Retiming the film means editing
// this file, with no change to how layers move.
export const T = {
  heroEnd: 26,
  cloudsIn: 18,
  cloudsCover: 70,
  cloudsHold: 98,
  cloudsOut: 134,
  s1: 124,
  step: 78,
} as const;
export const start = (stage: number) => T.s1 + stage * T.step;
export const duskAt = start(5);
export const lightsOn = duskAt + 56;
export const filmEnd = lightsOn + 74;
/** The film's height in hundredths of a screen: the pin, plus the last screen scrolling away. */
export const filmHeight = filmEnd + 100;
/** How high each stage's new work reaches, so the mason's line stops where the work stops. */
export const REACH = [0.3, 0.42, 0.52, 0.7, 1, 1];

export const clamp = (value: number, low = 0, high = 1) =>
  value < low ? low : value > high ? high : value;
export const prog = (from: number, to: number, value: number) =>
  clamp((value - from) / (to - from));
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Which words are showing at this point in the film. -1 before the first stage. */
export function currentPanel(s: number) {
  if (s <= T.s1 - 2) return -1;
  let current = 0;
  for (let i = 1; i < 5; i++) if (s >= start(i) + T.step * 0.14) current = i;
  if (s >= duskAt + 34) current = 5;
  return current;
}
/** One panel's opacity and travel. */
export function panelState(i: number, s: number) {
  const a = i === 0 ? T.s1 - 2 : i === 5 ? duskAt + 34 : start(i) + T.step * 0.08;
  const b = a + T.step * 0.2;
  const end = i < 4 ? start(i + 1) + T.step * 0.08 : i === 4 ? duskAt + 18 : 1e9;
  const inn = easeOut(prog(a, b, s));
  const out = prog(end - T.step * 0.14, end, s);
  return { opacity: inn * (1 - out), y: (1 - inn) * 18 - out * 14 };
}
/** Where the rail jumps to for a stage. */
export const jumpFor = (stage: number) =>
  stage === 5 ? lightsOn + 44 : start(stage) + T.step * 0.7;
/** The plates the film needs now, so the rest can stay unloaded or hidden. Indexes 0 to 5. */
export function platesNear(s: number) {
  if (s < 60) return [];
  const here = s < start(0) ? 0 : Math.min(5, Math.floor((s - T.s1) / T.step));
  return [here - 1, here, here + 1].filter((i) => i >= 0 && i <= 5);
}
/** After 120 frames, more than 10% slow frames steps the film down one notch at a time. */
export function needsStepDown(gaps: number[]) {
  if (gaps.length < 120) return false;
  return gaps.filter((gap) => gap > 34).length / gaps.length > 0.1;
}
