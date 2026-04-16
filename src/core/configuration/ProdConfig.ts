import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";
import { Env } from "./Env";

export const prodConfig = new (class extends DefaultServerConfig {
  numWorkers(): number {
    const parsed = Number.parseInt(process.env.WEB_CONCURRENCY ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, 20);
    }

    // Conservative default for platforms like Render where memory is often
    // the limiting factor and WEB_CONCURRENCY may be unset.
    return 2;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  jwtAudience(): string {
    return Env.JWT_AUDIENCE ?? Env.DOMAIN ?? "openfront.io";
  }
  turnstileSiteKey(): string {
    return "0x4AAAAAACFLkaecN39lS8sk";
  }
})();
