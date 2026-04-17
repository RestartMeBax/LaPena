import { base64url } from "jose";
import { Logger } from "winston";
import { Cosmetics, CosmeticsSchema } from "../core/CosmeticSchemas";
import {
  FailOpenPrivilegeChecker,
  PrivilegeChecker,
  PrivilegeCheckerImpl,
} from "./Privilege";

// Retry quickly on failure until the first successful load, then switch to
// the normal refresh interval.
const RETRY_INTERVAL_MS = 5_000; // 5 seconds

// Refreshes the privilege checker every 3 minutes.
// WARNING: This fails open if cosmetics.json is not available.
export class PrivilegeRefresher {
  private privilegeChecker: PrivilegeChecker | null = null;
  private failOpenPrivilegeChecker: PrivilegeChecker =
    new FailOpenPrivilegeChecker();
  private refreshInFlight: Promise<void> | null = null;
  private stopped = false;

  private log: Logger;

  constructor(
    private cosmeticsEndpoint: string,
    private profaneWordsEndpoint: string,
    private apiKey: string,
    parentLog: Logger,
    private refreshInterval: number = 1000 * 60 * 3,
    private localCosmeticsBuilder?: () => Cosmetics | null,
  ) {
    this.log = parentLog.child({ comp: "privilege-refresher" });
  }

  public async start() {
    this.log.info(
      `Starting privilege refresher with interval ${this.refreshInterval}`,
    );
    this.poll();
  }

  private poll() {
    if (this.stopped) return;
    this.loadPrivilegeChecker()
      .catch((error) => {
        this.log.error("Error in privilege refresh poll:", error);
      })
      .finally(() => {
        if (this.stopped) return;
        // Retry quickly until we have a working checker, then use normal interval.
        const delay =
          this.privilegeChecker === null
            ? RETRY_INTERVAL_MS
            : this.refreshInterval;
        setTimeout(() => this.poll(), delay);
      });
  }

  public get(): PrivilegeChecker {
    return this.privilegeChecker ?? this.failOpenPrivilegeChecker;
  }

  public async refreshNow(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.loadPrivilegeChecker().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async loadPrivilegeChecker(): Promise<void> {
    this.log.info(`Loading privilege checker`);
    try {
      const fetchWithTimeout = async (url: string) => {
        try {
          return await fetch(url, {
            signal: AbortSignal.timeout(5000),
            headers: { "x-api-key": this.apiKey },
          });
        } catch (error) {
          this.log.warn(`Failed to fetch ${url}: ${error}`);
          return null;
        }
      };

      const [cosmeticsResponse, profaneWordsResponse] = await Promise.all([
        fetchWithTimeout(this.cosmeticsEndpoint),
        fetchWithTimeout(this.profaneWordsEndpoint),
      ]);

      let cosmetics: Cosmetics | null = null;

      if (cosmeticsResponse && cosmeticsResponse.ok) {
        const cosmeticsData = await cosmeticsResponse.json();
        const result = CosmeticsSchema.safeParse(cosmeticsData);
        if (result.success) {
          cosmetics = result.data;
        } else {
          this.log.error(
            `Invalid cosmetics data from endpoint: ${result.error.message}`,
          );
        }
      } else {
        this.log.warn(
          `Cosmetics HTTP error: ${cosmeticsResponse?.status ?? "network error"}`,
        );
      }

      // Fall back to building cosmetics from the local database.
      if (cosmetics === null && this.localCosmeticsBuilder) {
        this.log.info("Falling back to local cosmetics builder");
        const local = this.localCosmeticsBuilder();
        if (local) {
          const result = CosmeticsSchema.safeParse(local);
          if (result.success) {
            cosmetics = result.data;
            this.log.info("Local cosmetics builder succeeded");
          } else {
            this.log.error(
              `Invalid local cosmetics data: ${result.error.message}`,
            );
          }
        }
      }

      if (cosmetics === null) {
        throw new Error(
          "Failed to load cosmetics from endpoint and local fallback",
        );
      }

      let bannedWords: string[] = [];
      if (profaneWordsResponse && profaneWordsResponse.ok) {
        try {
          bannedWords = await profaneWordsResponse.json();
          this.log.info(
            `Loaded ${bannedWords.length} profane words from ${this.profaneWordsEndpoint}`,
          );
        } catch (error) {
          this.log.warn(`Failed to parse profane words JSON, using empty list`);
        }
      } else {
        this.log.warn(
          `Failed to fetch profane words (status ${profaneWordsResponse?.status ?? "network error"}), using empty list`,
        );
      }

      this.privilegeChecker = new PrivilegeCheckerImpl(
        cosmetics,
        base64url.decode,
        bannedWords,
      );
      this.log.info(`Privilege checker loaded successfully`);
    } catch (error) {
      this.log.error(`Failed to load privilege checker:`, error);
      throw error;
    }
  }
}
