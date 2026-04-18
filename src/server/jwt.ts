import { jwtVerify } from "jose";
import { z } from "zod";
import {
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { GameEnv, ServerConfig } from "../core/configuration/Config";
import { PersistentIdSchema } from "../core/Schemas";

type TokenVerificationResult =
  | {
      type: "success";
      persistentId: string;
      claims: TokenPayload | null;
    }
  | { type: "error"; message: string };

export async function verifyClientToken(
  token: string,
  config: ServerConfig,
): Promise<TokenVerificationResult> {
  if (PersistentIdSchema.safeParse(token).success) {
    // Anonymous joins use persistent IDs instead of JWTs.
    // Keep them blocked only when access is explicitly flare-restricted.
    if (config.allowedFlares() !== undefined) {
      return {
        type: "error",
        message: "persistent ID not allowed when flare-restricted access is enabled",
      };
    }

    return { type: "success", persistentId: token, claims: null };
  }
  // Try HS256 first — the built-in AuthRoutes signs tokens with HS256.
  try {
    const secret = new TextEncoder().encode(
      process.env.AUTH_JWT_SECRET ?? "robuste-dev-secret",
    );
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (sub) {
      const claims: TokenPayload = {
        jti: typeof payload.jti === "string" ? payload.jti : "local",
        sub,
        iat: typeof payload.iat === "number" ? payload.iat : 0,
        iss: typeof payload.iss === "string" ? payload.iss : "",
        aud: typeof payload.aud === "string" ? payload.aud : "",
        exp: typeof payload.exp === "number" ? payload.exp : 0,
      };
      return { type: "success", persistentId: sub, claims };
    }
  } catch {
    // Not a valid HS256 token — fall through to EdDSA/JWKS path.
  }
  try {
    const issuer = config.jwtIssuer();
    const audience = config.jwtAudience();
    const key = await config.jwkPublicKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer,
      audience,
    });
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      return {
        type: "error",
        message: z.prettifyError(result.error),
      };
    }
    const claims = result.data;
    const persistentId = claims.sub;
    return { type: "success", persistentId, claims };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "An unknown error occurred";

    return { type: "error", message };
  }
}

export async function getUserMe(
  token: string,
  config: ServerConfig,
): Promise<
  | { type: "success"; response: UserMeResponse }
  | { type: "error"; message: string }
> {
  try {
    // Get the user object from the local auth server
    const response = await fetch(config.jwtIssuer() + "/api/auth/me", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status !== 200) {
      return {
        type: "error",
        message: `Failed to fetch user me: ${response.statusText}`,
      };
    }
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      return {
        type: "error",
        message: `Invalid response: ${z.prettifyError(result.error)}`,
      };
    }
    return { type: "success", response: result.data };
  } catch (e) {
    return {
      type: "error",
      message: `Failed to fetch user me: ${e}`,
    };
  }
}
