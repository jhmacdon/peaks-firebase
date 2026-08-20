// ISO 3166-1 / 3166-2 region lookups. Destinations and areas store raw
// geocoded codes (country_code, state_code / state_codes) — this file is
// the single place that turns them into names a reader recognizes. Any code
// with no match falls back to hiding, never to printing the raw code.

// ISO 3166-1 alpha-2 country codes, common short English names.
const COUNTRY_NAMES: Record<string, string> = {
  AD: "Andorra",
  AE: "United Arab Emirates",
  AF: "Afghanistan",
  AG: "Antigua and Barbuda",
  AI: "Anguilla",
  AL: "Albania",
  AM: "Armenia",
  AO: "Angola",
  AQ: "Antarctica",
  AR: "Argentina",
  AS: "American Samoa",
  AT: "Austria",
  AU: "Australia",
  AW: "Aruba",
  AX: "Åland Islands",
  AZ: "Azerbaijan",
  BA: "Bosnia and Herzegovina",
  BB: "Barbados",
  BD: "Bangladesh",
  BE: "Belgium",
  BF: "Burkina Faso",
  BG: "Bulgaria",
  BH: "Bahrain",
  BI: "Burundi",
  BJ: "Benin",
  BL: "Saint Barthélemy",
  BM: "Bermuda",
  BN: "Brunei",
  BO: "Bolivia",
  BQ: "Bonaire, Sint Eustatius and Saba",
  BR: "Brazil",
  BS: "Bahamas",
  BT: "Bhutan",
  BV: "Bouvet Island",
  BW: "Botswana",
  BY: "Belarus",
  BZ: "Belize",
  CA: "Canada",
  CC: "Cocos (Keeling) Islands",
  CD: "DR Congo",
  CF: "Central African Republic",
  CG: "Congo",
  CH: "Switzerland",
  CI: "Ivory Coast",
  CK: "Cook Islands",
  CL: "Chile",
  CM: "Cameroon",
  CN: "China",
  CO: "Colombia",
  CR: "Costa Rica",
  CU: "Cuba",
  CV: "Cape Verde",
  CW: "Curaçao",
  CX: "Christmas Island",
  CY: "Cyprus",
  CZ: "Czechia",
  DE: "Germany",
  DJ: "Djibouti",
  DK: "Denmark",
  DM: "Dominica",
  DO: "Dominican Republic",
  DZ: "Algeria",
  EC: "Ecuador",
  EE: "Estonia",
  EG: "Egypt",
  EH: "Western Sahara",
  ER: "Eritrea",
  ES: "Spain",
  ET: "Ethiopia",
  FI: "Finland",
  FJ: "Fiji",
  FK: "Falkland Islands",
  FM: "Micronesia",
  FO: "Faroe Islands",
  FR: "France",
  GA: "Gabon",
  GB: "United Kingdom",
  GD: "Grenada",
  GE: "Georgia",
  GF: "French Guiana",
  GG: "Guernsey",
  GH: "Ghana",
  GI: "Gibraltar",
  GL: "Greenland",
  GM: "Gambia",
  GN: "Guinea",
  GP: "Guadeloupe",
  GQ: "Equatorial Guinea",
  GR: "Greece",
  GS: "South Georgia and the South Sandwich Islands",
  GT: "Guatemala",
  GU: "Guam",
  GW: "Guinea-Bissau",
  GY: "Guyana",
  HK: "Hong Kong",
  HM: "Heard Island and McDonald Islands",
  HN: "Honduras",
  HR: "Croatia",
  HT: "Haiti",
  HU: "Hungary",
  ID: "Indonesia",
  IE: "Ireland",
  IL: "Israel",
  IM: "Isle of Man",
  IN: "India",
  IO: "British Indian Ocean Territory",
  IQ: "Iraq",
  IR: "Iran",
  IS: "Iceland",
  IT: "Italy",
  JE: "Jersey",
  JM: "Jamaica",
  JO: "Jordan",
  JP: "Japan",
  KE: "Kenya",
  KG: "Kyrgyzstan",
  KH: "Cambodia",
  KI: "Kiribati",
  KM: "Comoros",
  KN: "Saint Kitts and Nevis",
  KP: "North Korea",
  KR: "South Korea",
  KW: "Kuwait",
  KY: "Cayman Islands",
  KZ: "Kazakhstan",
  LA: "Laos",
  LB: "Lebanon",
  LC: "Saint Lucia",
  LI: "Liechtenstein",
  LK: "Sri Lanka",
  LR: "Liberia",
  LS: "Lesotho",
  LT: "Lithuania",
  LU: "Luxembourg",
  LV: "Latvia",
  LY: "Libya",
  MA: "Morocco",
  MC: "Monaco",
  MD: "Moldova",
  ME: "Montenegro",
  MF: "Saint Martin",
  MG: "Madagascar",
  MH: "Marshall Islands",
  MK: "North Macedonia",
  ML: "Mali",
  MM: "Myanmar",
  MN: "Mongolia",
  MO: "Macau",
  MP: "Northern Mariana Islands",
  MQ: "Martinique",
  MR: "Mauritania",
  MS: "Montserrat",
  MT: "Malta",
  MU: "Mauritius",
  MV: "Maldives",
  MW: "Malawi",
  MX: "Mexico",
  MY: "Malaysia",
  MZ: "Mozambique",
  NA: "Namibia",
  NC: "New Caledonia",
  NE: "Niger",
  NF: "Norfolk Island",
  NG: "Nigeria",
  NI: "Nicaragua",
  NL: "Netherlands",
  NO: "Norway",
  NP: "Nepal",
  NR: "Nauru",
  NU: "Niue",
  NZ: "New Zealand",
  OM: "Oman",
  PA: "Panama",
  PE: "Peru",
  PF: "French Polynesia",
  PG: "Papua New Guinea",
  PH: "Philippines",
  PK: "Pakistan",
  PL: "Poland",
  PM: "Saint Pierre and Miquelon",
  PN: "Pitcairn Islands",
  PR: "Puerto Rico",
  PS: "Palestine",
  PT: "Portugal",
  PW: "Palau",
  PY: "Paraguay",
  QA: "Qatar",
  RE: "Réunion",
  RO: "Romania",
  RS: "Serbia",
  RU: "Russia",
  RW: "Rwanda",
  SA: "Saudi Arabia",
  SB: "Solomon Islands",
  SC: "Seychelles",
  SD: "Sudan",
  SE: "Sweden",
  SG: "Singapore",
  SH: "Saint Helena",
  SI: "Slovenia",
  SJ: "Svalbard and Jan Mayen",
  SK: "Slovakia",
  SL: "Sierra Leone",
  SM: "San Marino",
  SN: "Senegal",
  SO: "Somalia",
  SR: "Suriname",
  SS: "South Sudan",
  ST: "São Tomé and Príncipe",
  SV: "El Salvador",
  SX: "Sint Maarten",
  SY: "Syria",
  SZ: "Eswatini",
  TC: "Turks and Caicos Islands",
  TD: "Chad",
  TF: "French Southern Territories",
  TG: "Togo",
  TH: "Thailand",
  TJ: "Tajikistan",
  TK: "Tokelau",
  TL: "Timor-Leste",
  TM: "Turkmenistan",
  TN: "Tunisia",
  TO: "Tonga",
  TR: "Turkey",
  TT: "Trinidad and Tobago",
  TV: "Tuvalu",
  TW: "Taiwan",
  TZ: "Tanzania",
  UA: "Ukraine",
  UG: "Uganda",
  UM: "United States Minor Outlying Islands",
  US: "United States",
  UY: "Uruguay",
  UZ: "Uzbekistan",
  VA: "Vatican City",
  VC: "Saint Vincent and the Grenadines",
  VE: "Venezuela",
  VG: "British Virgin Islands",
  VI: "U.S. Virgin Islands",
  VN: "Vietnam",
  VU: "Vanuatu",
  WF: "Wallis and Futuna",
  WS: "Samoa",
  YE: "Yemen",
  YT: "Mayotte",
  ZA: "South Africa",
  ZM: "Zambia",
  ZW: "Zimbabwe",
};

// ISO 3166-2 subdivision codes, by country. Only countries whose state/
// province codes actually appear in the Peaks catalog as state_code are
// worth maintaining here today (see docs/audits/2026-08-19-peaks-self-audit.md);
// an unmapped subdivision falls back to the country name rather than a raw
// code, so it's safe to leave a country out until it needs one.
const SUBDIVISIONS: Record<string, Record<string, string>> = {
  US: {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    DC: "District of Columbia",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
    AS: "American Samoa",
    GU: "Guam",
    MP: "Northern Mariana Islands",
    PR: "Puerto Rico",
    VI: "U.S. Virgin Islands",
  },
};

/** Full country name for an ISO 3166-1 alpha-2 code, or null if unknown. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRY_NAMES[code.toUpperCase()] ?? null;
}

/** Full state/province name for an ISO 3166-2 code, or null if the country
 * or the specific subdivision isn't in the table yet. */
export function subdivisionName(
  countryCode: string | null | undefined,
  stateCode: string | null | undefined
): string | null {
  if (!countryCode || !stateCode) return null;
  return SUBDIVISIONS[countryCode.toUpperCase()]?.[stateCode.toUpperCase()] ?? null;
}

/** "Washington, United States" for a single destination's state + country.
 * Drops whichever half doesn't resolve instead of ever printing a raw code;
 * returns null only when neither resolves. */
export function formatRegion(
  stateCode: string | null | undefined,
  countryCode: string | null | undefined
): string | null {
  const country = countryName(countryCode);
  const state = subdivisionName(countryCode, stateCode);
  if (state && country) return `${state}, ${country}`;
  return state ?? country ?? null;
}

/** "Washington, Oregon" for an area that spans several states — falls back
 * to the country name when none of the state codes resolve. */
export function formatRegionList(
  stateCodes: readonly string[] | null | undefined,
  countryCode: string | null | undefined
): string | null {
  const states = (stateCodes ?? [])
    .map((code) => subdivisionName(countryCode, code))
    .filter((name): name is string => Boolean(name));
  if (states.length > 0) return states.join(", ");
  return countryName(countryCode);
}

// ── /peaks/[state] slug mapping ─────────────────────────────────────────
// The URL uses the full lowercase state name ("/peaks/north-carolina"), not
// the two-letter code the database stores — a reader can't type "NC" into a
// browser bar with any confidence, and a reader can always spell out where
// they're going. Both directions derive from the same SUBDIVISIONS.US table
// above, so a new territory only needs adding there once.

/** "North Carolina" -> "north-carolina". Plain ASCII in, plain ASCII out —
 * every value in SUBDIVISIONS.US is already unaccented English. */
function slugifyStateName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let usStateSlugToCode: Map<string, string> | null = null;

function usStateSlugMap(): Map<string, string> {
  if (!usStateSlugToCode) {
    usStateSlugToCode = new Map(
      Object.entries(SUBDIVISIONS.US).map(([code, name]) => [slugifyStateName(name), code])
    );
  }
  return usStateSlugToCode;
}

/** "washington" -> "WA", or null when the slug isn't a mapped US state or
 * territory — the caller's signal to 404 rather than render an empty page. */
export function usStateCodeFromSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return usStateSlugMap().get(slug.toLowerCase()) ?? null;
}

/** "WA" -> "washington", or null when the code isn't mapped. Inverse of
 * usStateCodeFromSlug, built from the same table so the two can't drift. */
export function usStateSlugFromCode(code: string | null | undefined): string | null {
  const name = subdivisionName("US", code);
  return name ? slugifyStateName(name) : null;
}

/** Every mapped US state/territory code — the full domain a build-time
 * catalog query can be checked against, and the source for a fallback list
 * when that query can't run at all. */
export function allUsStateCodes(): string[] {
  return Object.keys(SUBDIVISIONS.US);
}
