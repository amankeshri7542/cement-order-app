// Reads scroll, writes transforms and opacity. No React, and nothing reads layout while scrolling:
// positions are measured once after load and again when the width changes.
import { geometry } from '../art/geometry';
import {
  currentPanel,
  duskAt,
  easeInOut as eio,
  easeOut as eo,
  jumpFor,
  lightsOn,
  needsStepDown,
  panelState,
  platesNear,
  prog,
  REACH,
  start,
  T,
} from './tracks';

type El = HTMLElement & { __t?: string; __o?: string; __v?: string; __live?: boolean };
const $ = (selector: string, root: ParentNode = document) => root.querySelector<El>(selector);
const $$ = (selector: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<El>(selector));
const set = (el: El | null, transform?: string, opacity?: string) => {
  if (!el) return;
  if (transform !== undefined && el.__t !== transform) {
    el.style.transform = transform;
    el.__t = transform;
  }
  if (opacity !== undefined && el.__o !== opacity) {
    el.style.opacity = opacity;
    el.__o = opacity;
  }
};
const show = (el: El | null, on: boolean) => {
  if (!el) return;
  const value = on ? 'visible' : 'hidden';
  if (el.__v !== value) {
    el.style.visibility = value;
    el.__v = value;
  }
};
function report(name: string, value?: number) {
  try {
    navigator.sendBeacon?.('/api/e', JSON.stringify({ name, value, path: location.pathname }));
  } catch {
    /* A lost signal costs nothing. */
  }
}

export function startFilm(tier: 'full' | 'lite') {
  const film = $('[data-film-root]');
  const stage = $('[data-stage]');
  if (!film || !stage) return () => {};
  const root = document.documentElement;
  const heroCopy = $('[data-hero-copy]');
  const ratebar = $('[data-ratebar]');
  const dusk = $('[data-dusk]');
  const cloudsFront = $('[data-clouds-front]');
  const cloudsBack = $('[data-clouds-back]');
  const heroPlate = $('[data-hero-plate]');
  const heroInner = heroPlate?.firstElementChild as El | null;
  const panImg = $('[data-pan]');
  const panTrack = $('[data-pan-track]');
  const ghost = $('[data-ghost]');
  const camera = $('[data-camera]');
  const camera2 = $('[data-camera2]');
  const box = $('[data-story-box]');
  const thread = $('[data-thread]');
  const tractor = $('[data-tractor]');
  const interlude = $('[data-interlude]');
  const rail = $('[data-rail]');
  const slices = $('[data-slices]');
  const sliceEls = $$('[data-slice]');
  const plateEls = $$('[data-plate]');
  const panels = $$('[data-panel]');
  const railButtons = $$('[data-go]', rail ?? document);

  let phone = innerWidth < 900;
  let vh = 0;
  let vw = 0;
  let boxH = 0;
  let filmTop = 0;
  let filmH = 0;
  let cloudH = { top: 0, solid: 0, under: 0, wall: 0, end: 0, full: 0 };
  let ratebarH = 68;
  let tractorW = 0;
  let tractorH = 0;
  let panRise = 0;
  let sections: { top: number; bottom: number; tone: string }[] = [];
  const ready = new Set<number>();

  const pickSrc = (img: HTMLImageElement) =>
    (phone ? img.dataset.srcM : img.dataset.srcD) ?? img.dataset.srcD ?? '';
  function loadImage(img: HTMLImageElement | null, done?: () => void) {
    if (!img) return;
    const url = pickSrc(img);
    if (!url) return;
    if (img.dataset.loaded === url) {
      done?.();
      return;
    }
    img.dataset.loaded = url;
    img.fetchPriority = 'low';
    img.decoding = 'async';
    img.src = url;
    img.decode?.().then(done, () => {
      // A plate that fails leaves words and rates standing alone, as if intended.
      img.dataset.failed = '1';
    });
  }

  function measure() {
    vw = stage!.clientWidth || innerWidth;
    vh = stage!.clientHeight || innerHeight;
    phone = vw < 900;
    const layout = phone ? geometry.phone : geometry.desktop;
    const page = (el: HTMLElement) => el.getBoundingClientRect().top + scrollY;
    filmTop = page(film!);
    filmH = film!.offsetHeight;
    boxH = box?.offsetHeight ?? vh;
    ratebarH = ratebar?.offsetHeight ?? 68;
    cloudH = {
      top: vh * layout.clouds.topH,
      solid: vh * layout.clouds.solidH,
      under: vh * layout.clouds.underH,
      wall: vh * layout.clouds.wallTop,
      end: vh * (layout.clouds.topH + layout.clouds.solidH),
      full: vh * (layout.clouds.topH + layout.clouds.solidH + layout.clouds.underH),
    };
    tractorW = tractor?.offsetWidth ?? 0;
    tractorH = tractor?.offsetHeight ?? 0;
    const heroVars = (heroInner?.dataset[phone ? 'panVarsM' : 'panVarsD'] ?? '{}') as string;
    if (heroInner) {
      const vars = JSON.parse(heroVars) as Record<string, string>;
      for (const [name, value] of Object.entries(vars)) heroInner.style.setProperty(name, value);
    }
    panRise = (panTrack?.offsetHeight ?? 0) * layout.pan.rise;
    if (thread && box) {
      thread.style.left = `${layout.thread.left * 100}%`;
      thread.style.width = `${layout.thread.width * 100}%`;
    }
    layout.slices.slice(0, -1).forEach((cut, index) => {
      const el = sliceEls[index];
      if (!el) return;
      const next = layout.slices[index + 1]!;
      el.style.left = `${cut * 100}%`;
      el.style.width = `${(next - cut) * 100}%`;
      const img = el.firstElementChild as HTMLImageElement | null;
      if (img) {
        img.style.width = `${(1 / (next - cut)) * 100}%`;
        img.style.left = `${(-cut / (next - cut)) * 100}%`;
      }
    });
    sections = Array.from(
      document.querySelectorAll<HTMLElement>('main section[data-nav-tone], footer'),
    ).map((el) => {
      const top = page(el);
      return {
        top,
        bottom: top + el.offsetHeight,
        tone: el.tagName === 'FOOTER' ? 'night' : (el.dataset.navTone ?? 'day'),
      };
    });
  }

  let lastPanel = -2;
  function apply(s: number) {
    const hOut = prog(T.heroEnd * 0.6, T.heroEnd + 22, s);
    if (!phone)
      set(
        heroCopy,
        `translate3d(0, calc(-56% - ${(eio(hOut) * vh * 0.1).toFixed(1)}px), 0)`,
        (1 - hOut).toFixed(3),
      );
    else set(heroCopy, 'translate3d(0,0,0)', (1 - hOut).toFixed(3));
    set(
      ratebar,
      `translate3d(0, ${(eio(prog(T.heroEnd * 0.5, T.heroEnd + 10, s)) * 100).toFixed(2)}%, 0)`,
    );
    show(heroCopy, hOut < 1);
    show(ratebar, s < T.heroEnd + 12);

    // Resting low around the base, the clouds rise and cover everything, hold, then pass out of frame.
    const rest = vh - ratebarH - (phone ? 4 : 18) - cloudH.wall;
    const coverA = -cloudH.wall - vh * 0.02;
    const coverB = vh - cloudH.end + vh * 0.02;
    let cy: number;
    if (s < T.cloudsCover) cy = rest + (coverA - rest) * eio(prog(T.cloudsIn, T.cloudsCover, s));
    else if (s < T.cloudsHold)
      cy = coverA + (coverB - coverA) * prog(T.cloudsCover, T.cloudsHold, s);
    else {
      const q = prog(T.cloudsHold, T.cloudsOut, s);
      cy = coverB + (-cloudH.full - coverB) * q * q;
    }
    set(cloudsFront, `translate3d(0, ${cy.toFixed(1)}px, 0)`);
    show(cloudsFront, s < T.cloudsOut);
    set(cloudsBack, `translate3d(0, ${(-prog(0, T.cloudsCover, s) * vh * 0.18).toFixed(1)}px, 0)`);
    show(cloudsBack, s < T.cloudsCover);
    stage!.toggleAttribute('data-quiet', s >= T.cloudsOut);

    // Scrolling pulls the rope: the bori in the headline goes up.
    if (panImg) set(panImg, `translate3d(0, ${(-eio(prog(0, 46, s)) * panRise).toFixed(1)}px, 0)`);

    const covered = s >= T.cloudsCover;
    show(heroPlate, !covered);
    const hp = prog(0, T.cloudsCover, s);
    set(
      heroPlate,
      `translate3d(0, ${(-hp * vh * 0.05).toFixed(1)}px, 0) scale(${(1 + hp * 0.05).toFixed(4)})`,
    );

    // The cloud has gone white, so it is a sheet of paper now, and the plan is drawn on it.
    const ghostOn = covered
      ? 0.46 *
        eo(prog(T.cloudsCover, T.cloudsCover + 20, s)) *
        (1 - prog(start(4), start(4) + 40, s))
      : 0;
    set(ghost, undefined, ghostOn.toFixed(3));
    show(ghost, covered && s < start(4) + 40);
    const iOn = prog(T.cloudsCover - 12, T.cloudsCover - 1, s);
    const iOut = prog(T.cloudsHold, T.cloudsHold + 9, s);
    show(interlude, iOn > 0 && iOut < 1);
    if (iOn > 0 && iOut < 1)
      set(
        interlude,
        `translate3d(0, ${phone ? '' : 'calc(-50% + '}${((1 - eo(iOn)) * 22 - iOut * 22).toFixed(1)}px${phone ? '' : ')'}, 0)`,
        (eo(iOn) * (1 - iOut)).toFixed(3),
      );

    // Plates load one stage ahead. A plate shows only once decoded, so the words carry on without it.
    for (const index of platesNear(s)) {
      const el = plateEls[index];
      if (el && !ready.has(index)) {
        const img = el.firstElementChild as HTMLImageElement | null;
        if (img && !img.dataset.loaded)
          loadImage(img, () => {
            ready.add(index);
            schedule();
          });
      }
    }
    // Below the first screen until someone scrolls, so it is no part of the first load.
    if (s > 0) loadImage($('[data-clouds-under]') as unknown as HTMLImageElement);
    if (s > T.cloudsOut * 0.6 && ghost) loadImage(ghost as unknown as HTMLImageElement);
    if (s > lightsOn - 60)
      sliceEls.forEach((el) => loadImage(el.firstElementChild as HTMLImageElement | null));

    let threadY = -1;
    for (let i = 0; i < 5; i++) {
      const plate = plateEls[i] ?? null;
      const a = start(i);
      const wipeEnd = a + T.step * 0.62;
      if (i === 0) {
        show(plate, covered && s < start(1) + T.step && ready.has(0));
        set(plate, 'translate3d(0,0,0)');
        continue;
      }
      const q = prog(a, wipeEnd, s);
      const on = q > 0 && s < start(i + 1) + T.step && ready.has(i);
      show(plate, on);
      if (on) {
        const reach = q >= 1 ? 1 : eio(q) * REACH[i]!;
        const y = (1 - reach) * boxH;
        set(plate, `translate3d(0, ${y.toFixed(1)}px, 0)`);
        const inner = plate?.firstElementChild as El | null;
        if (inner) set(inner, `translate3d(0, ${(-y).toFixed(1)}px, 0)`);
        if (q > 0 && q < 1) threadY = y;
      }
    }
    if (threadY >= 0) set(thread, `translate3d(0, ${threadY.toFixed(1)}px, 0)`, '0.9');
    else set(thread, undefined, '0');

    // Dusk: the field falls to night, the scaffold is gone, the house stands dark.
    const d = eio(prog(duskAt, duskAt + 54, s));
    set(dusk, undefined, d.toFixed(3));
    const nightPlate = plateEls[5] ?? null;
    show(nightPlate, d > 0 && ready.has(5));
    set(nightPlate, undefined, d.toFixed(3));
    const plaster = plateEls[4] ?? null;
    set(plaster, undefined, d > 0 ? (1 - eio(prog(duskAt, duskAt + 40, s))).toFixed(3) : '1');
    show(slices, s > lightsOn - 6);
    sliceEls.forEach((el, i) => {
      const a = lightsOn + i * 6;
      set(el, undefined, eo(prog(a, a + 10, s)).toFixed(3));
    });

    // The tractor brings the first load, then leaves.
    const trIn = prog(start(0) - 24, start(0) + 46, s);
    const trOut = prog(start(1) - 10, start(1) + 22, s);
    const tOn = covered && s < start(1) + 24 && tractorW > 0;
    show(tractor, tOn);
    if (tOn) {
      const run = phone ? tractorW * 0.62 + 20 : tractorW + 54;
      const groundY = phone ? (box?.offsetTop ?? 0) + boxH - 8 : vh - 8;
      set(
        tractor,
        `translate3d(${(vw + 20 - eo(trIn) * run - eio(trOut) * vw * 0.2).toFixed(1)}px, ${(groundY - tractorH * 0.97).toFixed(1)}px, 0)`,
        (1 - trOut).toFixed(3),
      );
      loadImage(tractor?.firstElementChild as HTMLImageElement | null);
    }

    // A slow camera push, so the house never quite sits still.
    const push = `scale(${(1.07 - 0.07 * prog(start(0), start(5), s)).toFixed(4)})`;
    set(camera, push);
    set(camera2, push);

    const current = currentPanel(s);
    panels.forEach((panel, i) => {
      const { opacity, y } = panelState(i, s);
      const live = opacity > 0.5;
      if (panel.__live !== live) {
        panel.__live = live;
        panel.toggleAttribute('data-live', live);
        // Nothing in a hidden panel can take focus.
        $$('button, a', panel).forEach((control) => {
          (control as HTMLElement).tabIndex = live ? 0 : -1;
        });
      }
      if (opacity > 0.005 || panel.__o !== '0.000')
        set(panel, `translate3d(0, ${y.toFixed(1)}px, 0)`, opacity.toFixed(3));
    });
    if (current !== lastPanel) {
      lastPanel = current;
      railButtons.forEach((button, i) => {
        if (i === current) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
    }
    show(rail, current >= 0);
    set(rail, undefined, current >= 0 ? eo(prog(T.s1 - 2, T.s1 + 14, s)).toFixed(3) : '0');
    const night = d > 0.55;
    film!.toggleAttribute('data-night', night);
    rail?.toggleAttribute('data-night', night);
    setTone();
  }

  // Below the film the header follows the section under it.
  let lastTone = '';
  function setTone() {
    const pinEnd = filmTop + filmH - vh;
    let tone: string;
    if (scrollY < pinEnd) {
      tone = eio(prog(duskAt, duskAt + 54, target)) > 0.55 ? 'clear-night' : '';
    } else {
      const y = scrollY + 30;
      tone = 'night';
      for (const section of sections)
        if (y >= section.top && y < section.bottom) tone = section.tone;
    }
    if (tone === lastTone) return;
    lastTone = tone;
    if (tone) root.setAttribute('data-nav-tone', tone);
    else root.removeAttribute('data-nav-tone');
  }

  let target = 0;
  let current = 0;
  let raf = 0;
  let smooth = 0.2;
  function tick() {
    raf = 0;
    const diff = target - current;
    current = Math.abs(diff) < 0.02 ? target : current + diff * smooth;
    apply(current);
    if (current !== target) raf = requestAnimationFrame(tick);
    sample();
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function onScroll() {
    if (scrollY < filmTop + filmH + 40) {
      target = ((scrollY - filmTop) / vh) * 100;
      schedule();
    }
    setTone();
    if (scrollY > vh * 0.2 && !plateEls[0]?.querySelector('img')?.dataset.loaded) {
      loadImage(ghost as unknown as HTMLImageElement);
      loadImage(plateEls[0]?.firstElementChild as HTMLImageElement | null, () => {
        ready.add(0);
        schedule();
      });
    }
  }

  // Device hints are guesses, so the film also watches itself and steps down one notch at a time:
  // cloud drift off, dusk a hard cut, then no scroll smoothing. It never changes layout.
  let gaps: number[] = [];
  let lastFrame = 0;
  let cuts = tier === 'lite' ? 1 : 0;
  root.setAttribute('data-film-cut', String(cuts));
  function sample() {
    const now = performance.now();
    if (lastFrame && now - lastFrame < 200) gaps.push(now - lastFrame);
    lastFrame = now;
    if (gaps.length >= 120) {
      if (needsStepDown(gaps) && cuts < 3) {
        cuts++;
        root.setAttribute('data-film-cut', String(cuts));
        if (cuts >= 3) smooth = 1;
        report('film_stepdown', cuts);
      }
      gaps = [];
    }
  }

  function jump(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLElement>('[data-go]');
    if (!button) return;
    const i = Number(button.dataset.go);
    scrollTo({ top: filmTop + (jumpFor(i) / 100) * vh, behavior: 'auto' });
  }

  function loadStartingArt() {
    loadImage($('[data-clouds-front] img') as unknown as HTMLImageElement);
    if (!phone) loadImage($('[data-clouds-back] img') as unknown as HTMLImageElement);
    loadImage(panImg as unknown as HTMLImageElement);
  }

  let width = innerWidth;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Phones change height as the address bar moves. Only a real width change measures again.
      if (innerWidth === width) return;
      width = innerWidth;
      const wasPhone = phone;
      measure();
      if (wasPhone !== phone) {
        ready.clear();
        $$('[data-src-d]').forEach((img) => delete (img as HTMLElement).dataset.loaded);
        loadStartingArt();
      }
      target = current = ((scrollY - filmTop) / vh) * 100;
      apply(current);
    }, 200);
  }
  function remeasure() {
    measure();
    apply(current);
  }

  const onPopState = () => {
    target = ((scrollY - filmTop) / vh) * 100;
    schedule();
  };

  measure();
  target = current = ((scrollY - filmTop) / vh) * 100;
  apply(current);
  loadStartingArt();
  if (scrollY > vh * 0.2) onScroll();
  film.setAttribute('data-film-ready', '');
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize, { passive: true });
  addEventListener('popstate', onPopState);
  addEventListener('load', remeasure);
  document.fonts?.ready.then(remeasure).catch(() => {});
  rail?.addEventListener('click', jump);

  return function stop() {
    cancelAnimationFrame(raf);
    clearTimeout(resizeTimer);
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onResize);
    removeEventListener('popstate', onPopState);
    removeEventListener('load', remeasure);
    rail?.removeEventListener('click', jump);
    root.removeAttribute('data-nav-tone');
    root.removeAttribute('data-film-cut');
  };
}
