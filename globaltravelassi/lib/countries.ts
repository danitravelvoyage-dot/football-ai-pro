/** Countries offered in the request form (ISO 3166-1 alpha-2). North Africa first. */
export const countryCodes = [
  "DZ", "MA", "TN", "LY", "EG", "MR",
  "FR", "ES", "IT", "DE", "BE", "NL", "PT", "GB", "CH", "AT", "GR", "HR", "BA", "IE", "SE", "NO", "DK", "PL", "CZ", "HU", "RO",
  "TR", "SA", "AE", "QA", "KW", "OM", "JO", "LB", "PS", "IQ",
  "US", "CA", "BR", "MX", "AR",
  "CN", "JP", "KR", "IN", "MY", "ID", "TH", "SG", "AU", "NZ", "ZA", "SN", "CI", "ML", "NG", "KE", "ET",
] as const;

export type CountryCode = (typeof countryCodes)[number];

export function isCountryCode(value: string): value is CountryCode {
  return (countryCodes as readonly string[]).includes(value);
}
