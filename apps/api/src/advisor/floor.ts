import type { AdvisorRoute, AdvisorTextKey } from '@shiv/shared';
import { romanizeHindi } from './understand-hindi';

/**
 * The first check on every question. Plain code with no network, so it works when the AI is down,
 * costs nothing, and cannot be argued with. A hit goes straight to fixed, reviewed text and never
 * reaches a model. It must not trip on an ordinary rate question ("sariya ka rate kitna hai"), and
 * apps/api/test/advisor-floor.test.ts holds fixtures in both directions.
 */
export type FloorHit = {
  route: AdvisorRoute;
  text: AdvisorTextKey;
  /** Which rule fired. Goes in logs and on the turn, never the customer's words. */
  rule: string;
};

const has = (text: string, pattern: RegExp) => pattern.test(text);

const crack = /\b(crack|cracks|cracked|cracking|daraar|darar|daraaren|fissure)\b/;
const structurePart =
  /\b(slab|slabs|chhat|chhatt|chhath|chat ki|chat ka|chat mein|chat par|lenter|lintel|lintal|linter|beam|beams|column|columns|pillar|pillars|khamba|khambha|footing|footings|foundation|foundations|neev|nio|plinth|raft|sunshade|chajja|chhajja|balcony|staircase|seedhi|roof|retaining)\b/;
const wholeBuilding = /\b(building|ghar|house|makaan|makan|floor|manzil|storey|story)\b/;
const wall = /\b(wall|walls|deewar|deewaar|diwar|dewar|bhit)\b/;
const steelOrMix =
  /\b(sariya|saria|sarya|steel|rod|rods|bar|bars|tmt|cement|concrete|masala|gitti|balu|sand|bori|bag|bags)\b/;
const howMuch = /\b(kitna|kitni|kitne|kitnaa|how much|how many|quantity|amount of)\b/;
const needs =
  /\b(lagega|lagegi|lagenge|lage|lagta|lagti|lagte|lagana|lagaun|lagayein|chahiye|need|needs|needed|required|require|use|used|dalna|daalna|dalun|daalun)\b/;
const sizing =
  /\b(size|sizes|spacing|gap|distance|thickness|thick|motai|mota|moti|depth|deep|gehri|gehra|gehrai|mm|soot|sut|grade|load|span|design|mix|masala|ratio|anupat|how strong|kitna strong)\b/;
const wantsPrice =
  /\b(rate|rates|price|prices|bhav|bhaav|daam|keemat|kimat|kitne ka|kitne ki|kitne ke|kitne mein|kitne me|per kilo|per kg|per bag|per bori)\b/;
const definition =
  /\b(what is|what's|what are|what does|meaning of|mean by|matlab|kya hota|kya hoti|kya hote|kya hai|kya hain|kise kehte|kisko kehte|explain|fark|difference|between)\b/;
const personal =
  /\b(kitna|kitni|kitne|how much|how many|size|spacing|theek|thik|sahi|enough|should|chahiye|mere|meri|mera|hamare|my|for a|for the|sq ?ft|sqft|square|\d)\b/;
const noMoney =
  /\b(paisa nahi|paise nahi|paisa kam|paise kam|afford|no money|mehnga|mehenga|kharcha nahi|bina engineer|without (an )?engineer|bas andaza|bas andaaz|sirf andaza|sirf andaaz|just (a |an )?(guess|rough|idea|estimate)|rough (idea|estimate)|andaza bata|andaaz bata)\b/;

function danger(text: string): FloorHit | null {
  const hit = (rule: string): FloorHit => ({ route: 'DANGER_NOW', text: 'DANGER_NOW', rule });
  // A crack someone is worried about gets the safety text, never a verdict from us.
  if (
    has(text, crack) &&
    has(
      text,
      /\b(badh|badhti|badhta|badh rahi|badh raha|grow|growing|widen|widening|getting (bigger|wider)|chaud|chauda|chaudi|phail|spreading|bada ho|badi ho)\b/,
    )
  )
    return hit('crack-growing');
  if (
    has(text, crack) &&
    has(
      text,
      /\b(khatarnak|khatra|dangerous|danger|safe|surakshit|theek|thik|chinta|hairline|serious|risk|gir jayega|gir jayegi|putty|fill)\b/,
    )
  )
    return hit('crack-verdict');
  const part =
    /\b(plaster|chhat|chhatt|chat|ceiling|roof|balcony|chajja|chhajja|beam|column|pillar|khamba|wall|walls|deewar|deewaar|diwar|building|ghar|makaan)\b/;
  const falling =
    /\b(gir|girna|girne|gira|giri|gire|girta|girti|girte|falling|fell|collapse|collapsed|collapsing|dhah|dhaha|dhah gaya|toot gaya|toot gayi|tut gaya|tut gayi|sagging|sag|sagged|ludhak)\b/;
  if (has(text, part) && has(text, falling)) return hit('falling');
  if (
    has(text, wall) &&
    has(
      text,
      /\b(tilt|tilting|tilted|lean|leaning|bulge|bulging|jhuk|jhuki|jhuka|tedhi|terhi|tedha|fool gayi|phool gayi)\b/,
    )
  )
    return hit('wall-moving');
  const power = /\b(current|shock|live wire|bijli|spark|sparking|taar|wire|wires)\b/;
  const wet = /\b(seelan|damp|wet|paani|pani|water|geeli|geela|nami)\b/;
  if (has(text, power) && has(text, wet)) return hit('power-near-water');
  if (has(text, wall) && has(text, /\b(current|shock|bijli)\b/)) return hit('power-in-wall');
  if (
    has(
      text,
      /\b(gas leak|gas ki smell|aag lag|fire in|on fire|trapped|dab gaya|dab gayi|fas gaya)\b/,
    )
  )
    return hit('emergency');
  return null;
}

function injury(text: string): FloorHit | null {
  const hit = (rule: string): FloorHit => ({ route: 'OTHER_PROFESSIONAL', text: 'INJURY', rule });
  const material = /\b(cement|chuna|lime|balu|dust|masala)\b/;
  const onBody =
    has(text, /\b(aankh|eye|eyes|skin|chamdi)\b/) &&
    has(text, /\b(chala gaya|chali gayi|gaya|gayi|gir|lag|jal|jalan|burn|burning|in)\b/);
  const burntHand =
    has(text, /\b(haath|hand|hands)\b/) && has(text, /\b(jal|jalan|burn|burning)\b/);
  if (has(text, material) && (onBody || burntHand)) return hit('material-on-body');
  if (
    has(
      text,
      /\b(chot lag|chot aa|injur|injury|injured|bleeding|khoon|behosh|unconscious|haddi|fracture|electric shock)\b/,
    )
  )
    return hit('hurt');
  if (
    has(text, /\b(mistri|mazdoor|labour|labourer|worker|bachcha|child)\b/) &&
    has(text, /\b(gir gaya|gir gayi|fell|fall from)\b/)
  )
    return hit('fall');
  return null;
}

function structural(text: string): FloorHit | null {
  const hit = (key: AdvisorTextKey, rule: string): FloorHit => ({
    route: 'STRUCTURAL',
    text: has(text, noMoney) ? 'STRUCTURAL_NO_MONEY' : key,
    rule,
  });
  // Changing what is already standing: an engineer must see it first.
  if (
    has(
      text,
      /\b(second|extra|another|one more|next|third|doosri|dusri|duji|teesri|tisri|ek aur|aur ek|upar) (floor|storey|story|manzil|mala|mazil)\b/,
    ) ||
    has(
      text,
      /\b(add|adding|build|building|badha|badhana|badhani|banana|bana|jod|jodna|dalna|nikalna) .{0,20}\b(floor|storey|story|manzil|mala)\b/,
    ) ||
    has(
      text,
      /\b(floor|storey|story|manzil|mala) .{0,20}\b(add|badha|badhana|badhani|banana|bana sakte|bana lein|jod|jodna)\b/,
    )
  )
    return hit('STRUCTURAL_CHANGE', 'add-floor');
  const breaking =
    /\b(remove|removing|break|breaking|demolish|knock|cut|tod|todna|todni|toda|todi|todkar|hata|hatana|hatani|girana|kaat|kaatna)\b/;
  if ((has(text, wall) || has(text, /\b(column|pillar|beam|khamba)\b/)) && has(text, breaking))
    return hit('STRUCTURAL_CHANGE', 'break-wall');
  if (has(text, /\b(load bearing|load-bearing|bhar uthane|takat)\b/))
    return hit('STRUCTURAL_CHANGE', 'load-bearing');

  // Timing and temporary works.
  if (
    has(
      text,
      /\b(shuttering|shattering|centering|centring|de-?shuttering|props?|balli|ballia)\b/,
    ) &&
    has(
      text,
      /\b(din|days?|khol|kholna|kholein|hata|hatana|remove|removed|kab|when|how long|kitne)\b/,
    )
  )
    return hit('STRUCTURAL_WORK', 'shuttering');
  if (has(text, /\b(scaffold|scaffolding|earthing|grounding)\b/))
    return hit('STRUCTURAL_WORK', 'site-works');
  if (has(text, /\b(tank|water tank|pani ki tanki|tanki)\b/) && has(text, /\b(roof|chhat|chat)\b/))
    return hit('STRUCTURAL_WORK', 'roof-tank');

  // Being asked to play the engineer.
  if (
    has(
      text,
      /\b(you are (now )?(a |an |my )?(civil )?engineer|engineer ban|as an engineer|as a civil engineer)\b/,
    ) ||
    (has(text, /\b(pretend|act as|acting as|maan lo|imagine)\b/) &&
      has(text, /\b(engineer|architect|structural|thekedar|contractor)\b/))
  )
    return hit('STRUCTURAL_WORK', 'role-play');

  // No money for an engineer does not change the answer, however it is asked.
  if (
    has(text, noMoney) &&
    (has(text, structurePart) || has(text, steelOrMix) || has(text, /\bengineer\b/))
  )
    return hit('STRUCTURAL', 'no-money');

  // A ratio or a named mix, unless it is plaster sums the estimator route answers.
  const plasterSum =
    has(text, /\b(plaster|palaster)\b/) && has(text, howMuch) && !has(text, structurePart);
  // "2:30" is a time, so two digits after the colon are not a ratio.
  if (!plasterSum && has(text, /\b\d+(\.\d+)?\s*:\s*\d(?!\d)/))
    return hit('STRUCTURAL_WORK', 'ratio');
  if (has(text, /\bm\s?-?\s?(10|15|20|25|30|35|40)\b/) && !has(text, definition))
    return hit('STRUCTURAL_WORK', 'named-mix');
  if (
    has(
      text,
      /\b(mix ratio|mix design|concrete mix|water cement|masala ratio|masala kitna|masala ka ratio)\b/,
    )
  )
    return hit('STRUCTURAL_WORK', 'mix');
  if (
    has(text, /\bmix\b/) &&
    (has(text, structurePart) || has(text, /\b(concrete|footing|for my|give)\b/))
  )
    return hit('STRUCTURAL_WORK', 'mix');

  // Which steel to use is the engineer's call too. Which cement for plaster stays in the guide.
  if (
    has(
      text,
      /\b(which|kaun ?sa|kaunsi|kaun si|konsa|konsi|kon sa|kon si)\b.{0,20}\b(grade|sariya|saria|sarya|steel|fe ?\d+|tmt)\b/,
    ) ||
    has(text, /\bfe ?\d+\b.{0,30}\b(use|lagaun|lagayein|chahiye|should|better|sahi|theek)\b/)
  )
    return hit('STRUCTURAL', 'which-steel');

  // How much material goes in the building, in either word order.
  if (
    has(text, new RegExp(`${howMuch.source}\\s+(\\w+\\s+){0,3}${steelOrMix.source}`)) ||
    has(
      text,
      new RegExp(
        `${steelOrMix.source}\\s+(\\w+\\s+){0,3}${howMuch.source}\\s+(\\w+\\s+){0,2}${needs.source}`,
      ),
    )
  ) {
    const askingRate = has(text, wantsPrice) && !has(text, needs);
    const askingCount = has(
      text,
      /\b(stock|hai kya|available|bachi|bacha|left|aapke paas|paas hai|dukaan mein)\b/,
    );
    const plasterOnly = has(text, /\b(plaster|palaster)\b/) && !has(text, structurePart);
    // What one bag or one trolley holds is a question about the unit, not about a building.
    const oneUnit =
      has(text, /\b(trolley|truck|hyva|hiva|tractor)\b/) ||
      has(text, /\b((in a|in one|ek) (bag|bori)|(bag|bori) (mein|me|main))\b/);
    if (!askingRate && !askingCount && !plasterOnly && !oneUnit)
      return hit(
        has(text, /\b(sariya|saria|sarya|steel|rod|rods|bar|bars|tmt)\b/)
          ? 'STRUCTURAL'
          : 'STRUCTURAL_WORK',
        'how-much',
      );
  }

  // A part of the building and a question about its size or strength.
  if (has(text, structurePart)) {
    const onlyMeaning = has(text, definition) && !has(text, personal);
    const onlyRate = has(text, wantsPrice) && !has(text, sizing);
    if (!onlyMeaning && !onlyRate && (has(text, sizing) || has(text, howMuch)))
      return hit(
        has(text, /\b(mix|masala|ratio)\b/) ? 'STRUCTURAL_WORK' : 'STRUCTURAL',
        'part-size',
      );
  }
  // "Mere ghar mein kitna sariya", with no part named.
  if (
    has(text, wholeBuilding) &&
    has(text, howMuch) &&
    has(text, steelOrMix) &&
    has(text, needs) &&
    !has(text, wantsPrice)
  )
    return hit('STRUCTURAL', 'how-much-house');
  return null;
}

function privateOrAttack(text: string): FloorHit | null {
  if (
    has(
      text,
      /\b(ignore|disregard|forget|bypass|override)\b.{0,40}\b(instruction|instructions|rule|rules|prompt|prompts|guideline|guidelines|safety)\b/,
    ) ||
    has(
      text,
      /\b(system prompt|your prompt|your instructions|your rules|developer mode|dev mode|jailbreak|dan mode|god mode|print your|reveal your|repeat the (text|words) above)\b/,
    ) ||
    has(text, /\b(rules|instructions|niyam) (bhool|bhul|chhod|hata)/) ||
    has(text, /(^|\s)(system|assistant|developer)\s*:/) ||
    has(text, /<\/?\s*(system|script|assistant|instructions)\b/)
  )
    return { route: 'PRIVATE_OR_ATTACK', text: 'ATTACK', rule: 'injection' };
  if (
    has(
      text,
      /\b(salary|salaries|tankhwah|tankha|vetan|margin|margins|munafa|profit|kharid rate|purchase rate|buying rate|supplier|attendance|hazri|password|otp|api key|secret|admin|database)\b/,
    ) ||
    has(text, /\bstaff\b/) ||
    has(text, /\b\w+ ji (ka|ki|ke)\b/) ||
    has(text, /\b(doosre|dusre|other|another|kis) (grahak|customer|customers|party)\b/) ||
    has(
      text,
      /\b(udhaar|baaki|khata|balance|order)\b.{0,20}\b(of|for) (\w+ )?(sharma|gupta|singh|kumar|verma|yadav|mr|mrs|shri)\b/,
    )
  )
    return { route: 'PRIVATE_OR_ATTACK', text: 'PRIVATE', rule: 'private' };
  return null;
}

/** The text the rules read: lower case, Hindi in Roman, and letters un-spaced ("s a r i y a"). */
export function floorText(question: string): string {
  return romanizeHindi(question)
    .toLowerCase()
    .replace(/\b(\p{L})(?:[\s.\-_*]+(?=\p{L}\b))/gu, '$1')
    .replace(/(\p{L})\1{2,}/gu, '$1');
}

export function floorCheck(question: string): FloorHit | null {
  const text = floorText(question);
  return privateOrAttack(text) ?? injury(text) ?? danger(text) ?? structural(text);
}
