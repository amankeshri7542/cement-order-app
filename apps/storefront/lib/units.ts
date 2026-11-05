/** The unit people say: "50 kg bag" reads as "a bori (50 kg)". Anything else stays as the shop typed it. */
export function unitWords(unit: string) {
  const bag = unit.match(/^\s*(\d+)\s*kg\s*bag\s*$/i);
  if (bag) return { long: `a bori (${bag[1]} kg)`, short: 'a bori', slash: 'bori' };
  const kg = unit.match(/^\s*kg\b\s*(?:[·,-]\s*(.+))?$/i);
  if (kg) return { long: kg[1] ? `a kg, ${kg[1]}` : 'a kg', short: 'a kg', slash: 'kg' };
  const per = unit.match(/^\s*([\d,]+)\s+(.+)$/);
  if (per)
    return {
      long: `per ${per[1]} ${per[2]}`,
      short: `per ${per[1]} ${per[2]}`,
      // "₹8,500/1,000" says enough beside the word Bricks, and fits a small phone.
      slash: /^bricks?$/i.test(per[2]!) ? `${per[1]}` : `${per[1]} ${per[2]}`,
    };
  return { long: `a ${unit}`, short: `a ${unit}`, slash: unit };
}
