// Which version of the home page this visitor gets, decided before first paint. No attribute on
// <html> means the complete stacked page, so no script and any failure need no special case.
export type FilmTier = 'full' | 'lite' | 'still';
export type TierInput = {
  reducedMotion: boolean;
  height: number;
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
  off?: boolean;
};
export function filmTier(input: TierInput): FilmTier {
  const { reducedMotion, height, saveData, effectiveType, deviceMemory, off } = input;
  if (off || reducedMotion || height < 500 || height > 2000 || saveData) return 'still';
  if (effectiveType === '2g' || effectiveType === 'slow-2g' || effectiveType === '3g')
    return 'still';
  if (deviceMemory !== undefined && deviceMemory < 2) return 'still';
  if (deviceMemory !== undefined && deviceMemory <= 4) return 'lite';
  return 'full';
}

/**
 * The inline script in <head>: sets the tier and queues Add taps until the page's code arrives.
 * Written as text because it runs before anything else. lib/head-script.test.ts runs this exact
 * text against fake browsers, so the two rules cannot drift apart.
 */
export const headScript = (filmOff: boolean) =>
  `(function(w,d){var h=d.documentElement,n=w.navigator,c=n.connection||{},m=n.deviceMemory,t='full',e=c.effectiveType;h.classList.add('js');if(${filmOff ? 'true' : 'false'}||(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)||w.innerHeight<500||w.innerHeight>2000||c.saveData||e==='2g'||e==='slow-2g'||e==='3g'||m<2)t='';else if(m<=4)t='lite';if(t){h.setAttribute('data-film',t);w.setTimeout(function(){if(!w.__filmOn&&d.querySelector('[data-film-root]'))h.removeAttribute('data-film')},8000)}var q=w.__listQ=[];d.addEventListener('click',function(v){var g=v.target,b=g&&g.closest&&g.closest('[data-add],[data-step]');if(!b||w.__listOn)return;var o=b.closest('[data-line]');if(!o)return;var s=b.getAttribute('data-step');q.push({line:o.getAttribute('data-line'),step:s===null?null:+s});if(s===null)b.setAttribute('aria-pressed','true')},true)})(window,document);`;
