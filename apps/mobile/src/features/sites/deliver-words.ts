import { w } from '../../words';

/** The shop's name for the area when it filled one in. A zone's own name is the shop's business. */
export const deliverHereWords = (area: string, cost: string) =>
  area ? w('sites.deliverHere', { area, cost }) : w('sites.deliverHereNoArea', { cost });
