'use client';

import { useEffect } from 'react';

type Win = typeof window & { __filmOn?: boolean };

/**
 * Starts the film after the page is complete, on idle or the first scroll, and stops it on leaving.
 * Nothing heavy runs in the load window, so the film cannot cost the page its first paint.
 */
export function FilmLoader() {
  useEffect(() => {
    const root = document.documentElement;
    const tier = root.getAttribute('data-film');
    let stopped = false;
    let stop: (() => void) | undefined;
    const showClouds = () => {
      // The still page shows the cloud bank too, in its resting place.
      const clouds = document.querySelector<HTMLImageElement>('[data-clouds-front] img');
      if (!clouds || clouds.getAttribute('src')) return;
      const url = innerWidth >= 900 ? clouds.dataset.srcD : clouds.dataset.srcM;
      if (url) clouds.src = url;
    };
    if (tier !== 'full' && tier !== 'lite') {
      if (document.readyState === 'complete') showClouds();
      else addEventListener('load', showClouds, { once: true });
      return () => removeEventListener('load', showClouds);
    }
    const begin = () => {
      removeEventListener('scroll', begin);
      if (stopped || !root.getAttribute('data-film')) return;
      void import('./engine')
        .then(({ startFilm }) => {
          if (stopped || !root.getAttribute('data-film')) return;
          (window as Win).__filmOn = true;
          stop = startFilm(tier);
        })
        .catch(() => root.removeAttribute('data-film'));
    };
    addEventListener('scroll', begin, { once: true, passive: true });
    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 400));
    const whenLoaded = () => idle(begin);
    if (document.readyState === 'complete') whenLoaded();
    else addEventListener('load', whenLoaded, { once: true });
    return () => {
      stopped = true;
      removeEventListener('scroll', begin);
      removeEventListener('load', whenLoaded);
      stop?.();
    };
  }, []);
  return null;
}
