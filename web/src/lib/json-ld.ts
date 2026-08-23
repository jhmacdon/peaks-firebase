const SCHEMA_CONTEXT = "https://schema.org";
const ITEM_LIST_LIMIT = 50;

type JsonLd = Record<string, unknown>;

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function number(value: number | null | undefined): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined;
}

function geoCoordinates(input: {
  latitude?: number | null;
  longitude?: number | null;
  elevationMeters?: number | null;
}): JsonLd | undefined {
  const latitude = number(input.latitude);
  const longitude = number(input.longitude);
  if (latitude == null || longitude == null) return undefined;

  const elevation = number(input.elevationMeters);
  return {
    "@type": "GeoCoordinates",
    latitude,
    longitude,
    ...(elevation != null ? { elevation } : {}),
  };
}

export function buildOrganizationJsonLd(input: {
  name: string;
  url: string;
  logo?: string | null;
  description?: string | null;
  sameAs?: string[];
}): JsonLd {
  const logo = text(input.logo);
  const description = text(input.description);
  const sameAs = (input.sameAs ?? []).filter((entry) => Boolean(entry?.trim()));

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Organization",
    name: input.name,
    url: input.url,
    ...(logo ? { logo } : {}),
    ...(description ? { description } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

export function buildWebSiteJsonLd(input: {
  name: string;
  url: string;
  description?: string | null;
  /** Search URL with `{search_term_string}` where the query goes. Omit it and
   * no SearchAction is published. */
  searchUrlTemplate?: string | null;
}): JsonLd {
  const description = text(input.description);
  const searchUrlTemplate = text(input.searchUrlTemplate);

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    name: input.name,
    url: input.url,
    ...(description ? { description } : {}),
    ...(searchUrlTemplate
      ? {
          potentialAction: {
            "@type": "SearchAction",
            target: {
              "@type": "EntryPoint",
              urlTemplate: searchUrlTemplate,
            },
            "query-input": "required name=search_term_string",
          },
        }
      : {}),
  };
}

export function buildMobileApplicationJsonLd(input: {
  name: string;
  url: string;
  downloadUrl: string;
  operatingSystem: string;
  applicationCategory: string;
  description?: string | null;
  price?: number | null;
  priceCurrency?: string | null;
}): JsonLd {
  const description = text(input.description);
  const price = number(input.price);
  const priceCurrency = text(input.priceCurrency);

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "MobileApplication",
    name: input.name,
    url: input.url,
    downloadUrl: input.downloadUrl,
    operatingSystem: input.operatingSystem,
    applicationCategory: input.applicationCategory,
    ...(description ? { description } : {}),
    ...(price != null && priceCurrency
      ? {
          offers: {
            "@type": "Offer",
            price,
            priceCurrency,
          },
        }
      : {}),
  };
}

export function buildDestinationJsonLd(input: {
  name?: string | null;
  url: string;
  features?: string[];
  latitude?: number | null;
  longitude?: number | null;
  elevationMeters?: number | null;
}): JsonLd {
  const name = text(input.name);
  const geo = geoCoordinates(input);
  const isMountain = (input.features ?? []).some(
    (feature) => feature === "summit" || feature === "volcano"
  );

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": isMountain ? "Mountain" : "Place",
    ...(name ? { name } : {}),
    url: input.url,
    ...(geo ? { geo } : {}),
  };
}

export function buildAreaJsonLd(input: {
  name?: string | null;
  url: string;
  latitude?: number | null;
  longitude?: number | null;
}): JsonLd {
  const name = text(input.name);
  const geo = geoCoordinates(input);

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Park",
    ...(name ? { name } : {}),
    url: input.url,
    ...(geo ? { geo } : {}),
  };
}

export function buildRouteJsonLd(input: {
  name?: string | null;
  url: string;
  distanceMeters?: number | null;
  gainMeters?: number | null;
}): JsonLd {
  const name = text(input.name);
  const distance = number(input.distanceMeters);
  const gain = number(input.gainMeters);
  const additionalProperty = [
    ...(distance != null
      ? [
          {
            "@type": "PropertyValue",
            name: "Distance",
            value: distance,
            unitText: "meters",
          },
        ]
      : []),
    ...(gain != null
      ? [
          {
            "@type": "PropertyValue",
            name: "Elevation gain",
            value: gain,
            unitText: "meters",
          },
        ]
      : []),
  ];

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Place",
    ...(name ? { name } : {}),
    url: input.url,
    ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
  };
}

export function buildListJsonLd(input: {
  name?: string | null;
  url: string;
  numberOfItems?: number | null;
  items: Array<{ name?: string | null; url: string }>;
}): JsonLd {
  const name = text(input.name);
  const numberOfItems = number(input.numberOfItems);
  const itemListElement = input.items.slice(0, ITEM_LIST_LIMIT).map((item, index) => {
    const itemName = text(item.name);
    return {
      "@type": "ListItem",
      position: index + 1,
      ...(itemName ? { name: itemName } : {}),
      url: item.url,
    };
  });

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ItemList",
    ...(name ? { name } : {}),
    url: input.url,
    ...(numberOfItems != null ? { numberOfItems } : {}),
    itemListElement,
  };
}

export function buildFaqJsonLd(input: {
  items: Array<{ question?: string | null; answer?: string | null }>;
}): JsonLd {
  const mainEntity = input.items.flatMap((item) => {
    const question = text(item.question);
    const answer = text(item.answer);
    if (!question || !answer) return [];

    return [
      {
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      },
    ];
  });

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    mainEntity,
  };
}
