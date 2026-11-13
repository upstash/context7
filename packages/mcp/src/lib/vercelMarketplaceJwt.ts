import * as jose from "jose";

const VERCEL_INTEGRATIONS_ORIGIN = "https://integrations.vercel.com";
const VERCEL_ISSUER_PATH = /^\/oac_[A-Za-z0-9]+$/;
const VERCEL_AUDIENCE_PATH = /^\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/icfg_[A-Za-z0-9]+$/;

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface VercelMarketplaceConfig {
  issuer: string;
  audience: string;
}

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;

function isExpectedVercelUrl(value: string, pathPattern: RegExp): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === VERCEL_INTEGRATIONS_ORIGIN &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      pathPattern.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function getConfig(): VercelMarketplaceConfig | null {
  const issuer = process.env.VERCEL_MARKETPLACE_OIDC_ISSUER ?? "";
  const audience = process.env.VERCEL_MARKETPLACE_OIDC_AUDIENCE ?? "";

  if (!isVercelMarketplaceIssuer(issuer) || !isExpectedVercelUrl(audience, VERCEL_AUDIENCE_PATH)) {
    return null;
  }
  return { issuer, audience };
}

function getJwks(issuer: string) {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
  }
  return jwks;
}

export function isVercelMarketplaceIssuer(issuer: string): boolean {
  return isExpectedVercelUrl(issuer, VERCEL_ISSUER_PATH);
}

export async function validateVercelMarketplaceJwt(
  token: string,
  tokenIssuer: string
): Promise<ValidationResult> {
  const config = getConfig();
  if (!config) return { valid: false, error: "Vercel Marketplace OIDC not configured" };
  if (tokenIssuer !== config.issuer) {
    return { valid: false, error: "Untrusted Vercel Marketplace issuer" };
  }

  const { payload } = await jose.jwtVerify(token, getJwks(config.issuer), {
    algorithms: ["RS256"],
    audience: config.audience,
    issuer: config.issuer,
    clockTolerance: 60,
  });
  if (typeof payload.resource !== "string" || !payload.resource) {
    return { valid: false, error: "Missing Vercel Marketplace resource" };
  }
  return { valid: true };
}
