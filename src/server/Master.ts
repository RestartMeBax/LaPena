import cluster from "cluster";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { MasterLobbyService } from "./MasterLobbyService";
import { AuthDatabase } from "./AuthDatabase";
import { registerAdminRoutes, registerImageServeRoutes } from "./AdminRoutes";
import { registerAuthRoutes } from "./AuthRoutes";
import { registerLiveContentRoutes } from "./LiveContentRoutes";
import { registerImageProxyRoutes } from "./ImageProxyRoutes";
import { registerShopRoutes } from "./ShopRoutes";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { renderAppShell } from "./RenderHtml";
import { applyStaticAssetCacheControl } from "./StaticAssetCache";
const config = getServerConfigFromServer();
const playlist = new MapPlaylist();
let lobbyService: MasterLobbyService;

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

function getSiteFromHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1") {
    return normalized;
  }
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length < 2) {
    return normalized;
  }
  return parts.slice(-2).join(".");
}

// CORS middleware for browser-to-API requests
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const originHost = originUrl.hostname;
      const reqHost = (req.get("host") ?? "").split(":")[0];
      const originSite = getSiteFromHostname(originHost);
      const reqSite = getSiteFromHostname(reqHost);
      const allowOrigin =
        originHost === reqHost ||
        (originSite === reqSite && originSite !== "");

      if (allowOrigin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, DELETE, OPTIONS",
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, Accept",
        );
        res.setHeader("Vary", "Origin");
      }
    } catch {
      // Ignore malformed origin header.
    }
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Serve the shared app shell for the root document.
app.use(async (req, res, next) => {
  if (req.path === "/") {
    try {
      await renderAppShell(
        res,
        path.join(__dirname, "../../static/index.html"),
      );
    } catch (error) {
      log.error("Error rendering index.html:", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    next();
  }
});

// Serve admin.html from resources directory
app.get("/admin.html", async (req, res, next) => {
  try {
    res.sendFile(path.join(__dirname, "../../resources/admin.html"));
  } catch (error) {
    log.error("Error serving admin.html:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res) => {
      applyStaticAssetCacheControl(
        res.setHeader.bind(res),
        res.req.originalUrl,
      );
    },
  }),
);

app.set("trust proxy", 3);
app.use(
  rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // 20 requests per IP per second
  }),
);

const authDb = new AuthDatabase();
registerAuthRoutes(app, authDb);
registerLiveContentRoutes(app, authDb);
registerImageProxyRoutes(app);
registerAdminRoutes(app, authDb);
registerImageServeRoutes(app, authDb);
registerShopRoutes(app, authDb);

app.use("/api", (_req, res, next) => {
  setNoStoreHeaders(res);
  next();
});

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);
  log.info(`Setting up ${config.numWorkers()} workers...`);

  lobbyService = new MasterLobbyService(config, playlist, log);

  // Generate admin token for worker authentication
  const ADMIN_TOKEN = crypto.randomBytes(16).toString("hex");
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;

  const INSTANCE_ID =
    config.env() === GameEnv.Dev
      ? "DEV_ID"
      : crypto.randomBytes(4).toString("hex");
  process.env.INSTANCE_ID = INSTANCE_ID;

  log.info(`Instance ID: ${INSTANCE_ID}`);

  // Fork workers
  for (let i = 0; i < config.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      ADMIN_TOKEN,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(i, worker);
    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (workerId === undefined) {
      log.error(`worker crashed could not find id`);
      return;
    }

    const workerIdNum = parseInt(workerId);
    lobbyService.removeWorker(workerIdNum);

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
      ADMIN_TOKEN,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(workerIdNum, newWorker);
    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const normalizedPort = (process.env.PORT ?? "").replace(/"/g, "").trim();
  const parsedPort = Number.parseInt(normalizedPort, 10);
  const PORT = config.env() === GameEnv.Dev ? (Number.isFinite(parsedPort) ? parsedPort : 8787) : 3000;
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });
}

app.get("/api/health", (_req, res) => {
  const ready = lobbyService?.isHealthy() ?? false;
  if (ready) {
    res.json({ status: "ok" });
  } else {
    res.status(503).json({ status: "unavailable" });
  }
});

app.get("/api/instance", (_req, res) => {
  res.json({
    instanceId: process.env.INSTANCE_ID ?? "undefined",
  });
});

// SPA fallback route
app.get("/{*splat}", async function (_req, res) {
  if (_req.path.startsWith("/maps/")) {
    return res.status(404).json({
      error: "Map asset not found",
      path: _req.path,
    });
  }

  try {
    const htmlPath = path.join(__dirname, "../../static/index.html");
    await renderAppShell(res, htmlPath);
  } catch (error) {
    log.error("Error rendering SPA fallback:", error);
    res.status(500).send("Internal Server Error");
  }
});
