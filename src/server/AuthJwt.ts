import { jwtVerify, SignJWT } from "jose";
import { Request } from "express";

function getAuthSecret() {
  return process.env.AUTH_JWT_SECRET ?? "robuste-dev-secret";
}

function getSigningKey() {
  return new TextEncoder().encode(getAuthSecret());
}

function getAudienceFromRequest(req: Request) {
  const hostname = req.hostname;
  if (!hostname) return "localhost";
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "localhost";
  }
  const parts = hostname.split(".").slice(-2);
  return parts.join(".");
}

function getIssuerFromRequest(req: Request) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol;
  const host = req.get("host");
  if (!host) {
    return process.env.AUTH_ISSUER ?? `${protocol}://localhost:8787`;
  }
  return `${protocol}://${host}`;
}

export async function signAuthToken(
  payload: Record<string, unknown>,
  req: Request,
): Promise<string> {
  const issuer = getIssuerFromRequest(req);
  const audience = getAudienceFromRequest(req);
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setIssuer(issuer)
    .setAudience(audience);

  if (typeof payload.sub === "string" && payload.sub.length > 0) {
    jwt.setSubject(payload.sub);
  }

  return await jwt.sign(getSigningKey());
}

export async function verifyAuthToken(
  token: string,
  req: Request,
): Promise<Record<string, unknown>> {
  const audience = getAudienceFromRequest(req);
  const isLocalAudience = audience === "localhost";

  const verifyOptions = isLocalAudience
    ? undefined
    : {
        audience,
      };

  const { payload } = await jwtVerify(token, getSigningKey(), verifyOptions);
  return payload as Record<string, unknown>;
}
