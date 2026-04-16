import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";
import { Env } from "./Env";

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  numWorkers(): number {
    return 2;
  }
  turnstileSiteKey(): string {
    return "0x4AAAAAAB7QetxHwRCKw-aP";
  }
  jwtAudience(): string {
    return Env.JWT_AUDIENCE ?? Env.DOMAIN ?? "openfront.dev";
  }
  allowedFlares(): string[] | undefined {
    return undefined;
    // TODO: Uncomment this after testing.
    // Allow access without login for now to test
    // the new login flow.
    // return [
    //   // "access:openfront.dev"
    // ];
  }
})();
