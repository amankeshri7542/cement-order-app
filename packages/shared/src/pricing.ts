/**
 * How a line's rate is worked out, the same way everywhere and always on the server. Whole paise
 * only. Nothing here can raise a rate above the list, or take it to zero.
 */
export type PriceRuleKind = 'SLAB' | 'GROUP' | 'SPECIAL' | 'OFFER';
export type PriceValueType = 'RATE' | 'PERCENT_OFF' | 'AMOUNT_OFF';
export type PriceRuleInput = {
  id: string;
  kind: PriceRuleKind;
  productId: string | null;
  categoryId: string | null;
  minQuantity: number;
  groupId: string | null;
  customerId: string | null;
  valueType: PriceValueType;
  /** Paise for RATE and AMOUNT_OFF. Hundredths of a percent for PERCENT_OFF: 250 is 2.5%. */
  value: number;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  /** An offer that may also apply on top of a customer's better rate. Owners choose this. */
  stacks: boolean;
};
export type PriceLineInput = {
  listPaise: number;
  quantity: number;
  productId: string;
  categoryId: string;
  customerId: string | null;
  groupId: string | null;
  /** The IST day, as YYYY-MM-DD. */
  day: string;
  rules: readonly PriceRuleInput[];
};
export type PricedLine = {
  pricePaise: number;
  ruleId: string | null;
  ruleKind: PriceRuleKind | null;
};

const percentScale = 10_000;
function rateAfter(rule: PriceRuleInput, base: number) {
  if (rule.valueType === 'RATE') return rule.value;
  if (rule.valueType === 'AMOUNT_OFF') return base - rule.value;
  // Rounded up, so a percentage never gives away more than it says.
  return Math.ceil((base * (percentScale - rule.value)) / percentScale);
}
function applies(rule: PriceRuleInput, line: PriceLineInput) {
  if (!rule.active) return false;
  if (rule.startsOn && line.day < rule.startsOn) return false;
  if (rule.endsOn && line.day > rule.endsOn) return false;
  if (rule.productId && rule.productId !== line.productId) return false;
  if (rule.categoryId && rule.categoryId !== line.categoryId) return false;
  if (line.quantity < rule.minQuantity) return false;
  if (rule.kind === 'GROUP' && (!rule.groupId || rule.groupId !== line.groupId)) return false;
  if (rule.kind === 'SPECIAL' && (!rule.customerId || rule.customerId !== line.customerId))
    return false;
  return true;
}
// A later-looking tie must not change a rate from one request to the next.
const inOrder = (a: PriceRuleInput, b: PriceRuleInput) => a.id.localeCompare(b.id);

export function priceLine(line: PriceLineInput): PricedLine {
  const matching = line.rules.filter((rule) => applies(rule, line)).sort(inOrder);
  let price = line.listPaise;
  let chosen: PriceRuleInput | null = null;
  // The lowest of the slab, the customer's group and their special rate.
  for (const rule of matching.filter((row) => row.kind !== 'OFFER')) {
    const rate = rateAfter(rule, line.listPaise);
    if (rate > 0 && rate < price) {
      price = rate;
      chosen = rule;
    }
  }
  // An offer only if lower. They do not add up, unless an owner allowed this offer to.
  const standing = price;
  for (const rule of matching.filter((row) => row.kind === 'OFFER')) {
    // A rule that would take a rate to nothing is a mistake, not a gift: it does not apply.
    const usable = [rateAfter(rule, line.listPaise), rule.stacks ? rateAfter(rule, standing) : 0];
    const rate = Math.min(...usable.filter((value) => value > 0), Number.POSITIVE_INFINITY);
    if (rate < price) {
      price = rate;
      chosen = rule;
    }
  }
  return {
    pricePaise: price,
    ruleId: chosen?.id ?? null,
    ruleKind: chosen?.kind ?? null,
  };
}
