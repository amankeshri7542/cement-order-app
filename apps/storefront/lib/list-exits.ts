// Which way a list can leave, from its state. Plan 03 section 4.3. One lead button, the rest quiet.
export type LineStatus =
  'ok' | 'over' | 'unavailable' | 'on_request' | 'invalid' | 'gone' | 'unknown';
export type PincodeState = 'none' | 'checking' | 'served' | 'not_served' | 'failed';
export type ExitName = 'order' | 'whatsapp' | 'rate';
export type ListExits = {
  lead: ExitName | null;
  others: ExitName[];
  orderOff: string | null;
  /** The server could not answer. Exits needing it stay available only when they can still work. */
  note: string | null;
};
const reasons: Partial<Record<LineStatus, string>> = {
  over: 'One line is large for an online order, so the shop will reply with a rate.',
  unavailable: 'One line is not available right now, so the shop will reply.',
  on_request: 'One line is brought in to order, so the shop will reply with a rate.',
  invalid: 'Check the quantity on the line marked below.',
  gone: 'One line is no longer sold. Take it off the list.',
};

export function chooseExits(input: {
  statuses: LineStatus[];
  pincode: PincodeState;
  whatsapp: boolean;
  online: boolean;
  checkFailed: boolean;
}): ListExits {
  const { statuses, pincode, whatsapp, online, checkFailed } = input;
  const withWhatsapp = (names: ExitName[]) =>
    names.filter((name) => name !== 'whatsapp' || whatsapp);
  if (!statuses.length) return { lead: null, others: [], orderOff: null, note: null };
  if (!online)
    return {
      lead: null,
      others: [],
      orderOff: 'You are offline.',
      note: 'You are offline. Your list is saved.',
    };
  const worst = (['gone', 'invalid', 'unavailable', 'on_request', 'over'] as const).find((status) =>
    statuses.includes(status),
  );
  if (worst) {
    const [lead = null, ...others] = withWhatsapp(['rate', 'whatsapp']);
    return { lead, others, orderOff: reasons[worst] ?? null, note: null };
  }
  if (pincode === 'not_served') {
    const [lead = null, ...others] = withWhatsapp(['whatsapp', 'rate']);
    return {
      lead,
      others,
      orderOff: 'The shop does not list this pincode for delivery yet.',
      note: null,
    };
  }
  if (checkFailed) {
    // The rates could not be checked. Placing still re-checks everything on the server, but it
    // should not lead until the shop can answer. A line merely not answered yet is not a failure.
    const [lead = null, ...others] = withWhatsapp(['whatsapp', 'rate']);
    return {
      lead,
      others,
      orderOff: 'The shop could not be reached to check this list. Try again in a moment.',
      note: 'The shop could not be reached just now. Your list is saved.',
    };
  }
  const [lead = null, ...others] = withWhatsapp(['order', 'whatsapp', 'rate']);
  return { lead, others, orderOff: null, note: null };
}
