import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export type UserRecord = {
  id: number;
  sub: string;
  email: string;
  displayName: string;
  profilePicture: string | null;
  roles: string[];
  createdAt: number;
};

export type AdminMapRecord = {
  id: number;
  key: string;
  name: string;
  description: string;
  imageUrl: string | null;
  mapUrl: string | null;
  enabled: boolean;
  createdAt: number;
};

export type AdminShopItemRecord = {
  id: number;
  itemType: string;
  itemKey: string;
  title: string;
  description: string;
  softPrice: number | null;
  hardPrice: number | null;
  metadataJson: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type MostWinLeaderboardRecord = {
  rank: number;
  playerId: string;
  username: string;
  clanTag?: string;
  flag?: string;
  wins: number;
};

const OWNER_ADMIN_EMAILS = new Set(
  [
    "ludovickjeux@gmail.com",
    ...(process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ].map((email) => normalizeEmail(email)),
);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parseRoles(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export class AuthDatabase {
  private readonly db: Database.Database;

  constructor() {
    const preferredDataDir =
      process.env.AUTH_DB_DIR?.trim() || path.join(process.cwd(), "data");
    let dataDir = preferredDataDir;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (error) {
      const fallbackDataDir = path.join("/tmp", "openfront-data");
      console.warn(
        `AuthDatabase: cannot use ${preferredDataDir}, falling back to ${fallbackDataDir}`,
        error,
      );
      dataDir = fallbackDataDir;
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "app.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.bootstrapOwnerAdmins();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        sub           TEXT    NOT NULL UNIQUE,
        email         TEXT    NOT NULL UNIQUE,
        display_name  TEXT    NOT NULL,
        profile_pic   TEXT,
        roles         TEXT    NOT NULL DEFAULT '[]',
        password_hash TEXT    NOT NULL,
        salt          TEXT    NOT NULL,
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS magic_links (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        token      TEXT    NOT NULL UNIQUE,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL,
        used       INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS flags (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        image_url   TEXT,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skins (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        image_url   TEXT,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS news (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        url         TEXT,
        image_url   TEXT,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_maps (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        key         TEXT    NOT NULL UNIQUE,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        image_url   TEXT,
        map_url     TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_shop_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type     TEXT    NOT NULL,
        item_key      TEXT    NOT NULL,
        title         TEXT    NOT NULL,
        description   TEXT    NOT NULL DEFAULT '',
        soft_price    INTEGER,
        hard_price    INTEGER,
        metadata_json TEXT,
        enabled       INTEGER NOT NULL DEFAULT 1,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        UNIQUE(item_type, item_key)
      );

      CREATE TABLE IF NOT EXISTS user_flares (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_sub   TEXT    NOT NULL,
        flare      TEXT    NOT NULL,
        granted_at INTEGER NOT NULL,
        UNIQUE(user_sub, flare)
      );

      CREATE TABLE IF NOT EXISTS user_currency (
        user_sub   TEXT    PRIMARY KEY,
        soft       INTEGER NOT NULL DEFAULT 0,
        hard       INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_wins (
        user_sub    TEXT    PRIMARY KEY,
        wins        INTEGER NOT NULL DEFAULT 0,
        username    TEXT,
        clan_tag    TEXT,
        flag        TEXT,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS uploaded_images (
        id           TEXT    PRIMARY KEY,
        content_type TEXT    NOT NULL,
        data         BLOB    NOT NULL,
        created_at   INTEGER NOT NULL
      );
    `);

    try {
      this.db.exec("ALTER TABLE user_wins ADD COLUMN username TEXT");
    } catch {}
    try {
      this.db.exec("ALTER TABLE user_wins ADD COLUMN clan_tag TEXT");
    } catch {}
    try {
      this.db.exec("ALTER TABLE user_wins ADD COLUMN flag TEXT");
    } catch {}
  }

  private bootstrapOwnerAdmins() {
    for (const email of OWNER_ADMIN_EMAILS) {
      if (!email) continue;
      this.ensureRoleForEmail(email, "admin");
    }
  }

  private ensureRoleForEmail(email: string, role: string) {
    const normalizedEmail = normalizeEmail(email);
    const row = this.db
      .prepare("SELECT id, roles FROM users WHERE email = ?")
      .get(normalizedEmail) as { id: number; roles: string | null } | undefined;
    if (!row) return;

    const roles = parseRoles(row.roles);
    if (roles.includes(role)) return;
    roles.push(role);
    this.db
      .prepare("UPDATE users SET roles = ? WHERE id = ?")
      .run(JSON.stringify(roles), row.id);
  }

  private defaultRolesForEmail(email: string): string[] {
    const normalizedEmail = normalizeEmail(email);
    if (OWNER_ADMIN_EMAILS.has(normalizedEmail)) {
      return ["admin"];
    }
    return [];
  }

  private rowToUserRecord(row: {
    id: number;
    sub: string;
    email: string;
    display_name: string;
    profile_pic: string | null;
    roles: string | null;
    created_at: number;
  }): UserRecord {
    return {
      id: row.id,
      sub: row.sub,
      email: row.email,
      displayName: row.display_name,
      profilePicture: row.profile_pic,
      roles: parseRoles(row.roles),
      createdAt: row.created_at,
    };
  }

  public createUser(
    email: string,
    password: string,
    displayName: string,
    profilePicture?: string,
  ): UserRecord {
    const normalizedEmail = normalizeEmail(email);
    const existing = this.db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(normalizedEmail);
    if (existing) {
      throw new Error("User already exists");
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const sub = crypto.randomUUID();
    const now = nowSeconds();

    const roles = this.defaultRolesForEmail(normalizedEmail);

    const stmt = this.db.prepare(
      `INSERT INTO users (sub, email, display_name, profile_pic, roles, password_hash, salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      sub,
      normalizedEmail,
      displayName,
      profilePicture ?? null,
      JSON.stringify(roles),
      passwordHash,
      salt,
      now,
    );

    return {
      id: result.lastInsertRowid as number,
      sub,
      email: normalizedEmail,
      displayName,
      profilePicture: profilePicture ?? null,
      roles,
      createdAt: now,
    };
  }

  public findUserByEmail(email: string): UserRecord | null {
    const normalizedEmail = normalizeEmail(email);
    const row = this.db
      .prepare("SELECT id, sub, email, display_name, profile_pic, roles, created_at FROM users WHERE email = ?")
      .get(normalizedEmail) as Parameters<typeof this.rowToUserRecord>[0] | undefined;
    return row ? this.rowToUserRecord(row) : null;
  }

  public verifyUserPassword(email: string, password: string): UserRecord | null {
    const normalizedEmail = normalizeEmail(email);
    const row = this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(normalizedEmail) as (Parameters<typeof this.rowToUserRecord>[0] & { password_hash: string; salt: string }) | undefined;
    if (!row) return null;

    const hashed = hashPassword(password, row.salt);
    if (!crypto.timingSafeEqual(Buffer.from(hashed, "hex"), Buffer.from(row.password_hash, "hex"))) {
      return null;
    }
    return this.rowToUserRecord(row);
  }

  public createMagicLink(email: string): string | null {
    const user = this.findUserByEmail(email);
    if (!user) return null;
    const token = crypto.randomBytes(24).toString("hex");
    this.db
      .prepare("INSERT INTO magic_links (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)")
      .run(token, user.id, nowSeconds() + 30 * 60);
    return token;
  }

  public consumeMagicLink(token: string): UserRecord | null {
    const link = this.db
      .prepare("SELECT id, user_id, expires_at, used FROM magic_links WHERE token = ?")
      .get(token) as { id: number; user_id: number; expires_at: number; used: number } | undefined;
    if (!link || link.used || link.expires_at < nowSeconds()) return null;
    this.db.prepare("UPDATE magic_links SET used = 1 WHERE id = ?").run(link.id);
    return this.getUserById(link.user_id);
  }

  public getUserById(id: number): UserRecord | null {
    const row = this.db
      .prepare("SELECT id, sub, email, display_name, profile_pic, roles, created_at FROM users WHERE id = ?")
      .get(id) as Parameters<typeof this.rowToUserRecord>[0] | undefined;
    return row ? this.rowToUserRecord(row) : null;
  }

  public updateUserProfile(
    userId: number,
    updates: { displayName?: string; profilePicture?: string },
  ): UserRecord | null {
    if (updates.displayName !== undefined) {
      this.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(updates.displayName, userId);
    }
    if (updates.profilePicture !== undefined) {
      this.db.prepare("UPDATE users SET profile_pic = ? WHERE id = ?").run(updates.profilePicture, userId);
    }
    return this.getUserById(userId);
  }

  public getFlags(): { id: number; name: string; description: string; imageUrl: string | null; createdAt: number }[] {
    const rows = this.db
      .prepare("SELECT id, name, description, image_url, created_at FROM flags ORDER BY created_at DESC")
      .all() as { id: number; name: string; description: string; image_url: string | null; created_at: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, imageUrl: r.image_url, createdAt: r.created_at }));
  }

  public getSkins(): { id: number; name: string; description: string; imageUrl: string | null; createdAt: number }[] {
    const rows = this.db
      .prepare("SELECT id, name, description, image_url, created_at FROM skins ORDER BY created_at DESC")
      .all() as { id: number; name: string; description: string; image_url: string | null; created_at: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, imageUrl: r.image_url, createdAt: r.created_at }));
  }

  public getNews(): { id: number; title: string; description: string; url: string | null; imageUrl: string | null; createdAt: number }[] {
    const rows = this.db
      .prepare("SELECT id, title, description, url, image_url, created_at FROM news ORDER BY created_at DESC")
      .all() as { id: number; title: string; description: string; url: string | null; image_url: string | null; created_at: number }[];
    return rows.map((r) => ({ id: r.id, title: r.title, description: r.description, url: r.url, imageUrl: r.image_url, createdAt: r.created_at }));
  }

  public createFlag(name: string, description: string, imageUrl?: string): void {
    this.db.prepare("INSERT INTO flags (name, description, image_url, created_at) VALUES (?, ?, ?, ?)")
      .run(name, description, imageUrl ?? null, nowSeconds());
  }

  public updateFlagImage(id: number, imageUrl: string): boolean {
    const result = this.db.prepare("UPDATE flags SET image_url = ? WHERE id = ?").run(imageUrl, id);
    return result.changes > 0;
  }

  public deleteFlagById(id: number): boolean {
    const result = this.db.prepare("DELETE FROM flags WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public createSkin(name: string, description: string, imageUrl?: string): void {
    this.db.prepare("INSERT INTO skins (name, description, image_url, created_at) VALUES (?, ?, ?, ?)")
      .run(name, description, imageUrl ?? null, nowSeconds());
  }

  public updateSkinImage(id: number, imageUrl: string): boolean {
    const result = this.db.prepare("UPDATE skins SET image_url = ? WHERE id = ?").run(imageUrl, id);
    return result.changes > 0;
  }

  public deleteSkinById(id: number): boolean {
    const result = this.db.prepare("DELETE FROM skins WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public createNews(title: string, description: string, url?: string, imageUrl?: string): void {
    this.db.prepare("INSERT INTO news (title, description, url, image_url, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(title, description, url ?? null, imageUrl ?? null, nowSeconds());
  }

  public deleteNewsById(id: number): boolean {
    const result = this.db.prepare("DELETE FROM news WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public getAdminMaps(): AdminMapRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, key, name, description, image_url, map_url, enabled, created_at FROM admin_maps ORDER BY created_at DESC",
      )
      .all() as {
      id: number;
      key: string;
      name: string;
      description: string;
      image_url: string | null;
      map_url: string | null;
      enabled: number;
      created_at: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      imageUrl: r.image_url,
      mapUrl: r.map_url,
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
    }));
  }

  public createAdminMap(input: {
    key: string;
    name: string;
    description?: string;
    imageUrl?: string;
    mapUrl?: string;
    enabled?: boolean;
  }): void {
    this.db
      .prepare(
        "INSERT INTO admin_maps (key, name, description, image_url, map_url, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.key,
        input.name,
        input.description ?? "",
        input.imageUrl ?? null,
        input.mapUrl ?? null,
        input.enabled === false ? 0 : 1,
        nowSeconds(),
      );
  }

  public deleteAdminMapById(id: number): boolean {
    const result = this.db.prepare("DELETE FROM admin_maps WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public getAdminShopItems(): AdminShopItemRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, item_type, item_key, title, description, soft_price, hard_price, metadata_json, enabled, created_at, updated_at FROM admin_shop_items ORDER BY updated_at DESC",
      )
      .all() as {
      id: number;
      item_type: string;
      item_key: string;
      title: string;
      description: string;
      soft_price: number | null;
      hard_price: number | null;
      metadata_json: string | null;
      enabled: number;
      created_at: number;
      updated_at: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      itemType: r.item_type,
      itemKey: r.item_key,
      title: r.title,
      description: r.description,
      softPrice: r.soft_price,
      hardPrice: r.hard_price,
      metadataJson: r.metadata_json,
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public upsertAdminShopItem(input: {
    itemType: string;
    itemKey: string;
    title: string;
    description?: string;
    softPrice?: number | null;
    hardPrice?: number | null;
    metadataJson?: string | null;
    enabled?: boolean;
  }): void {
    const now = nowSeconds();
    this.db
      .prepare(
        `INSERT INTO admin_shop_items (item_type, item_key, title, description, soft_price, hard_price, metadata_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_type, item_key) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           soft_price = excluded.soft_price,
           hard_price = excluded.hard_price,
           metadata_json = excluded.metadata_json,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.itemType,
        input.itemKey,
        input.title,
        input.description ?? "",
        input.softPrice ?? null,
        input.hardPrice ?? null,
        input.metadataJson ?? null,
        input.enabled === false ? 0 : 1,
        now,
        now,
      );
  }

  public deleteAdminShopItemById(id: number): boolean {
    const result = this.db.prepare("DELETE FROM admin_shop_items WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ── Flares ──────────────────────────────────────────────────────────────────

  public getUserFlares(userSub: string): string[] {
    const rows = this.db
      .prepare("SELECT flare FROM user_flares WHERE user_sub = ?")
      .all(userSub) as { flare: string }[];
    return rows.map((r) => r.flare);
  }

  public grantFlare(userSub: string, flare: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO user_flares (user_sub, flare, granted_at) VALUES (?, ?, ?)",
      )
      .run(userSub, flare, nowSeconds());
  }

  public hasFlare(userSub: string, flare: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM user_flares WHERE user_sub = ? AND flare = ?")
      .get(userSub, flare);
    return row !== undefined;
  }

  public revokeFlare(userSub: string, flare: string): boolean {
    const result = this.db
      .prepare("DELETE FROM user_flares WHERE user_sub = ? AND flare = ?")
      .run(userSub, flare);
    return result.changes > 0;
  }

  // ── Currency ─────────────────────────────────────────────────────────────────

  public getUserCurrency(userSub: string): { soft: number; hard: number } {
    const row = this.db
      .prepare("SELECT soft, hard FROM user_currency WHERE user_sub = ?")
      .get(userSub) as { soft: number; hard: number } | undefined;
    return row ?? { soft: 0, hard: 0 };
  }

  public addCurrency(
    userSub: string,
    type: "soft" | "hard",
    amount: number,
  ): void {
    if (type === "soft") {
      this.db
        .prepare(
          "INSERT INTO user_currency (user_sub, soft, hard) VALUES (?, ?, 0) ON CONFLICT(user_sub) DO UPDATE SET soft = soft + ?",
        )
        .run(userSub, amount, amount);
    } else {
      this.db
        .prepare(
          "INSERT INTO user_currency (user_sub, soft, hard) VALUES (?, 0, ?) ON CONFLICT(user_sub) DO UPDATE SET hard = hard + ?",
        )
        .run(userSub, amount, amount);
    }
  }

  /**
   * Deduct currency atomically. Returns false if balance is insufficient.
   */
  public spendCurrency(
    userSub: string,
    type: "soft" | "hard",
    amount: number,
  ): boolean {
    const col = type === "soft" ? "soft" : "hard";
    const result = this.db
      .prepare(
        `UPDATE user_currency SET ${col} = ${col} - ? WHERE user_sub = ? AND ${col} >= ?`,
      )
      .run(amount, userSub, amount);
    return result.changes > 0;
  }

  // ── Wins / Most Win Leaderboard ───────────────────────────────────────────

  public addWin(
    userSub: string,
    amount: number = 1,
    details?: {
      username?: string;
      clanTag?: string | null;
      flag?: string;
    },
  ): void {
    const inc = Math.max(1, Math.floor(amount));
    const now = nowSeconds();
    this.db
      .prepare(
        `INSERT INTO user_wins (user_sub, wins, username, clan_tag, flag, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_sub) DO UPDATE SET
           wins = wins + excluded.wins,
           username = COALESCE(excluded.username, user_wins.username),
           clan_tag = excluded.clan_tag,
           flag = COALESCE(excluded.flag, user_wins.flag),
           updated_at = excluded.updated_at`,
      )
      .run(
        userSub,
        inc,
        details?.username ?? null,
        details?.clanTag ?? null,
        details?.flag ?? null,
        now,
      );
  }

  public getUserWins(userSub: string): number {
    const row = this.db
      .prepare("SELECT wins FROM user_wins WHERE user_sub = ?")
      .get(userSub) as { wins: number } | undefined;
    return row?.wins ?? 0;
  }

  public getMostWinLeaderboard(
    page: number,
    pageSize: number,
  ): MostWinLeaderboardRecord[] {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;

    const rows = this.db
      .prepare(
        `SELECT
           uw.user_sub AS user_sub,
           COALESCE(uw.username, u.display_name) AS display_name,
           uw.clan_tag AS clan_tag,
           uw.flag AS flag,
           uw.wins AS wins
         FROM user_wins uw
         LEFT JOIN users u ON u.sub = uw.user_sub
         ORDER BY uw.wins DESC, uw.updated_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(safePageSize, offset) as {
      user_sub: string;
      display_name: string | null;
        clan_tag: string | null;
        flag: string | null;
      wins: number;
    }[];

    return rows.map((row, index) => ({
      rank: offset + index + 1,
      playerId: row.user_sub,
      username: row.display_name ?? "Unknown",
        clanTag: row.clan_tag ?? undefined,
        flag: row.flag ?? undefined,
      wins: row.wins,
    }));
  }

  // ── Uploaded Images ─────────────────────────────────────────────────────────

  public saveImage(
    id: string,
    contentType: string,
    data: Buffer,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO uploaded_images (id, content_type, data, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, contentType, data, nowSeconds());
  }

  public getImage(
    id: string,
  ): { contentType: string; data: Buffer } | null {
    const row = this.db
      .prepare("SELECT content_type, data FROM uploaded_images WHERE id = ?")
      .get(id) as { content_type: string; data: Buffer } | undefined;
    if (!row) return null;
    return { contentType: row.content_type, data: row.data };
  }
}
