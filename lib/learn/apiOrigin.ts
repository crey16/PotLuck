interface ApiOriginEnv {
  [key: string]: string | undefined;
  API_PORT?: string;
  VERCEL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

interface RequestOriginParts {
  host?: string | null;
  protocol?: string | null;
}

function firstHeaderValue(value?: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

function originForHost(hostValue?: string | null, protocolValue?: string | null): string | null {
  const host = firstHeaderValue(hostValue);
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) return null;
  const protocol = firstHeaderValue(protocolValue) === "http" ? "http" : "https";
  return `${protocol}://${host}`;
}

/**
 * Pick an origin for a server-rendered page to call this app's FastAPI routes.
 *
 * On Vercel, the generated VERCEL_URL can be deployment-protected even when
 * the production domain is public. Prefer the domain that received the page
 * request, then the stable production domain. Local development keeps using
 * the separately-run Python server.
 */
export function resolveApiOrigin(
  env: ApiOriginEnv,
  request: RequestOriginParts = {}
): string {
  if (env.VERCEL) {
    const requestOrigin = originForHost(request.host, request.protocol);
    if (requestOrigin) return requestOrigin;

    const productionOrigin = originForHost(env.VERCEL_PROJECT_PRODUCTION_URL, "https");
    if (productionOrigin) return productionOrigin;
  }

  return `http://127.0.0.1:${env.API_PORT ?? "8000"}`;
}
