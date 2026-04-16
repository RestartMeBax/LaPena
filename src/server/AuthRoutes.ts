import { Request, Response, Router } from "express";
import { AuthDatabase } from "./AuthDatabase";
import { signAuthToken, verifyAuthToken } from "./AuthJwt";

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split("; ")
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...value] = cookie.split("=");
        return [name, decodeURIComponent(value.join("="))];
      }),
  );
}

function sendRefreshCookie(res: Response, refreshToken: string) {
  const secure = process.env.NODE_ENV === "production";
  res.cookie("robuste_refresh_token", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function registerAuthRoutes(app: Router, db: AuthDatabase) {
  const authRouter = Router();

  const sendUserMe = async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }
    const token = authHeader.substring("Bearer ".length);
    try {
      const payload = await verifyAuthToken(token, req);
      const email = typeof payload.email === "string" ? payload.email : undefined;
      const sub = typeof payload.sub === "string" ? payload.sub : "";
      const roles = Array.isArray(payload.roles)
        ? payload.roles.map((r) => String(r))
        : [];

      const flares = sub ? db.getUserFlares(sub) : [];
      const currency = sub ? db.getUserCurrency(sub) : { soft: 0, hard: 0 };
      const wins = sub ? db.getUserWins(sub) : 0;

      return res.json({
        user: {
          email,
        },
        player: {
          publicId: sub,
          roles,
          flares,
          achievements: {
            singleplayerMap: [],
          },
          wins,
          currency,
        },
      });
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
  };

  authRouter.post("/register", async (req, res) => {
    const { email, password, displayName, profilePicture } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      if (db.findUserByEmail(email)) {
        return res.status(400).json({ error: "Account already exists" });
      }
      const user = db.createUser(email, password, displayName, profilePicture);
      const jwt = await signAuthToken(
        {
          sub: user.sub,
          email: user.email,
          displayName: user.displayName,
          roles: user.roles,
        },
        req,
      );
      sendRefreshCookie(res, jwt);
      return res.json({ success: true, jwt, expiresIn: 3600, user });
    } catch (error) {
      return res.status(500).json({ error: "Unable to create account" });
    }
  });

  authRouter.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }
    const user = db.verifyUserPassword(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const jwt = await signAuthToken(
      {
        sub: user.sub,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
      },
      req,
    );
    sendRefreshCookie(res, jwt);
    return res.json({ success: true, jwt, expiresIn: 3600, user });
  });

  authRouter.post("/refresh", async (req, res) => {
    try {
      const cookies = parseCookies(req);
      const refreshToken = cookies["robuste_refresh_token"];
      if (!refreshToken) {
        return res.status(401).json({ error: "No refresh token" });
      }
      const payload = await verifyAuthToken(refreshToken, req);
      const jwt = await signAuthToken(payload, req);
      return res.json({ jwt, expiresIn: 3600, payload });
    } catch (error) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }
  });

  authRouter.post("/logout", async (_req, res) => {
    res.clearCookie("robuste_refresh_token", { path: "/" });
    return res.json({ success: true });
  });

  authRouter.get("/me", sendUserMe);

  app.get("/leaderboard/most-win", async (req, res) => {
    const rawPage = Number(req.query.page ?? "1");
    const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
    const players = db.getMostWinLeaderboard(page, 50);
    return res.json({ players });
  });

  authRouter.patch("/profile", async (req, res) => {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }
    const token = authHeader.substring("Bearer ".length);
    try {
      const payload = await verifyAuthToken(token, req);
      const userId = payload.sub ? Number(payload.sub) : null;
      if (!userId || Number.isNaN(userId)) {
        return res.status(400).json({ error: "Invalid user id" });
      }
      const { displayName, profilePicture } = req.body;
      const updated = db.updateUserProfile(userId, {
        displayName,
        profilePicture,
      });
      return res.json({ user: updated });
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
  });

  authRouter.post("/magic-link", async (req, res) => {
    const { email, redirectDomain } = req.body;
    if (!email || !redirectDomain) {
      return res.status(400).json({ error: "Missing email or redirectDomain" });
    }
    const token = db.createMagicLink(email);
    if (!token) {
      return res.status(200).json({ success: true });
    }
    return res.json({
      success: true,
      magicLink: `${redirectDomain}/auth.html?login-token=${encodeURIComponent(
        token,
      )}`,
    });
  });

  authRouter.get("/login/token", async (req, res) => {
    const token = String(req.query["login-token"] ?? "");
    if (!token) {
      return res.status(400).json({ error: "Missing login-token" });
    }
    const user = db.consumeMagicLink(token);
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const jwt = await signAuthToken(
      {
        sub: user.sub,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
      },
      req,
    );
    sendRefreshCookie(res, jwt);
    return res.json({ success: true, email: user.email });
  });

  app.use("/api/auth", authRouter);
  app.get("/users/@me", sendUserMe);
}
