/**
 * Cost from tokens and the owner's own price list. Pure. A price the owner has not entered gives null:
 * the platform never estimates a cost, because no price is known to it.
 */
export interface PriceList {
  /** Price per 1,000 input tokens, in the owner's currency. Undefined when not entered. */
  inPer1k?: number;
  /** Price per 1,000 output tokens. Undefined when not entered. */
  outPer1k?: number;
}

export function costOf(tokensIn: number, tokensOut: number, prices: PriceList): number | null {
  if (prices.inPer1k === undefined || prices.outPer1k === undefined) return null;
  return Math.round(((tokensIn / 1000) * prices.inPer1k + (tokensOut / 1000) * prices.outPer1k) * 10_000) / 10_000;
}
