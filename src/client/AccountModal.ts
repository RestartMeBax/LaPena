import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  PlayerGame,
  PlayerStatsTree,
  UserMeResponse,
} from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import { getRuntimeClientServerConfig } from "../core/configuration/ConfigLoader";
import { fetchPlayerById, getApiBase, getUserMe } from "./Api";
import { discordLogin, logOut, setAuthJwt } from "./Auth";
import "./components/baseComponents/stats/DiscordUserHeader";
import "./components/baseComponents/stats/GameList";
import "./components/baseComponents/stats/PlayerStatsTable";
import "./components/baseComponents/stats/PlayerStatsTree";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/CurrencyDisplay";
import "./components/Difficulties";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends BaseModal {
  @state() private email: string = "";
  @state() private isLoadingUser: boolean = false;
  @state() private authMode: "login" | "register" = "login";
  @state() private authEmail: string = "";
  @state() private authPassword: string = "";
  @state() private authDisplayName: string = "";
  @state() private authError: string = "";
  @state() private authLoading: boolean = false;
  @state() private authShowPw: boolean = false;

  private userMeResponse: UserMeResponse | null = null;
  private statsTree: PlayerStatsTree | null = null;
  private recentGames: PlayerGame[] = [];

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        this.userMeResponse = customEvent.detail as UserMeResponse;
        if (this.userMeResponse?.player?.publicId === undefined) {
          this.statsTree = null;
          this.recentGames = [];
        }
      } else {
        this.statsTree = null;
        this.recentGames = [];
        this.requestUpdate();
      }
    });
  }

  private hasAnyStats(): boolean {
    if (!this.statsTree) return false;
    // Check if statsTree has any data
    return (
      Object.keys(this.statsTree).length > 0 &&
      Object.values(this.statsTree).some(
        (gameTypeStats) =>
          gameTypeStats && Object.keys(gameTypeStats).length > 0,
      )
    );
  }

  render() {
    const content = this.isLoadingUser
      ? this.renderLoadingSpinner(
          translateText("account_modal.fetching_account"),
        )
      : this.renderInner();

    if (this.inline) {
      return this.isLoadingUser
        ? html`<div class="${this.modalContainerClass}">
            ${modalHeader({
              title: translateText("account_modal.title"),
              onBack: () => this.close(),
              ariaLabel: translateText("common.back"),
            })}
            ${content}
          </div>`
        : content;
    }

    return html`
      <o-modal
        id="account-modal"
        title=""
        ?hideCloseButton=${true}
        ?inline=${this.inline}
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  private renderInner() {
    const isLoggedIn = !!this.userMeResponse?.user;
    const title = translateText("account_modal.title");
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    const displayId = publicId || translateText("account_modal.not_found");

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title,
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
          rightContent: isLoggedIn
            ? html`
                <div class="flex items-center gap-2">
                  <span
                    class="text-xs text-blue-400 font-bold uppercase tracking-wider"
                    >${translateText("account_modal.personal_player_id")}</span
                  >
                  <copy-button
                    .lobbyId=${publicId}
                    .copyText=${publicId}
                    .displayText=${displayId}
                  ></copy-button>
                </div>
              `
            : undefined,
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1">
          ${isLoggedIn ? this.renderAccountInfo() : this.renderLoginOptions()}
        </div>
      </div>
    `;
  }

  private renderAccountInfo() {
    const me = this.userMeResponse?.user;
    const isLinked = me?.discord ?? me?.email;

    if (!isLinked) {
      return this.renderLoginOptions();
    }

    return html`
      <div class="p-6">
        <div class="flex flex-col gap-6">
          <!-- Top Row: Connected As -->
          <div class="bg-white/5 rounded-xl border border-white/10 p-6">
            <div class="flex flex-col items-center gap-4">
              <div
                class="text-xs text-white/40 uppercase tracking-widest font-bold border-b border-white/5 pb-2 px-8"
              >
                ${translateText("account_modal.connected_as")}
              </div>
              <div class="flex items-center gap-8 justify-center flex-wrap">
                <discord-user-header
                  .data=${this.userMeResponse?.user?.discord ?? null}
                ></discord-user-header>
                ${this.renderLoggedInAs()}
              </div>
            </div>
          </div>

          <!-- Middle Row: Stats Section -->
          ${this.hasAnyStats()
            ? html`<div
                class="bg-white/5 rounded-xl border border-white/10 p-6"
              >
                <h3
                  class="text-lg font-bold text-white mb-4 flex items-center gap-2"
                >
                  <span class="text-blue-400">📊</span>
                  ${translateText("account_modal.stats_overview")}
                </h3>
                <player-stats-tree-view
                  .statsTree=${this.statsTree}
                ></player-stats-tree-view>
              </div>`
            : ""}

          <!-- Bottom Row: Recent Games Section -->
          <div class="bg-white/5 rounded-xl border border-white/10 p-6">
            <h3
              class="text-lg font-bold text-white mb-4 flex items-center gap-2"
            >
              <span class="text-blue-400">🎮</span>
              ${translateText("game_list.recent_games")}
            </h3>
            <game-list
              .games=${this.recentGames}
              .onViewGame=${(id: string) => void this.viewGame(id)}
            ></game-list>
          </div>
        </div>
      </div>
    `;
  }

  private renderCurrency(): TemplateResult {
    const currency = this.userMeResponse?.player?.currency;
    if (!currency) return html``;

    return html`
      <currency-display
        .hard=${currency.hard}
        .soft=${currency.soft}
      ></currency-display>
    `;
  }

  private renderLoggedInAs(): TemplateResult {
    const me = this.userMeResponse?.user;
    if (me?.discord) {
      return html`
        <div class="flex flex-col items-center gap-3 w-full">
          ${this.renderCurrency()} ${this.renderLogoutButton()}
        </div>
      `;
    } else if (me?.email) {
      return html`
        <div class="flex flex-col items-center gap-3 w-full">
          <div class="text-white text-lg font-medium">
            ${translateText("account_modal.linked_account", {
              account_name: me.email,
            })}
          </div>
          ${this.renderCurrency()} ${this.renderLogoutButton()}
        </div>
      `;
    }
    return html``;
  }

  private async viewGame(gameId: string): Promise<void> {
    this.close();
    const config = await getRuntimeClientServerConfig();
    const encodedGameId = encodeURIComponent(gameId);
    const newUrl = `/${config.workerPath(gameId)}/game/${encodedGameId}`;

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(
      new CustomEvent("join-changed", { detail: { gameId: encodedGameId } }),
    );
  }

  private renderLogoutButton(): TemplateResult {
    return html`
      <button
        @click="${this.handleLogout}"
        class="px-6 py-2 text-sm font-bold text-white uppercase tracking-wider bg-red-600/80 hover:bg-red-600 border border-red-500/50 rounded-lg transition-all shadow-lg hover:shadow-red-900/40"
      >
        ${translateText("account_modal.log_out")}
      </button>
    `;
  }

  private renderLoginOptions(): TemplateResult {
  const isLogin = this.authMode === "login";
    return html`
      <div class="flex items-center justify-center p-6 min-h-full">
        <div class="w-full max-w-md bg-white/5 rounded-2xl border border-white/10 p-8 flex flex-col gap-5">

          <!-- Tabs -->
          <div class="flex bg-white/5 rounded-xl p-1 gap-1">
            <button
              class="flex-1 py-3 rounded-lg text-sm font-bold uppercase tracking-wider transition-all
                ${isLogin ? "bg-blue-700 text-white shadow" : "text-white/40 hover:text-white/70"}"
              @click="${() => { this.authMode = "login"; this.authError = ""; }}"
            >Sign In</button>
            <button
              class="flex-1 py-3 rounded-lg text-sm font-bold uppercase tracking-wider transition-all
                ${!isLogin ? "bg-blue-700 text-white shadow" : "text-white/40 hover:text-white/70"}"
              @click="${() => { this.authMode = "register"; this.authError = ""; }}"
            >Create Account</button>
          </div>

          <!-- Email -->
          <div class="flex flex-col gap-1">
            <label class="text-xs font-bold text-white/40 uppercase tracking-wider">Email</label>
            <input
              type="email"
              .value="${this.authEmail}"
              @input="${(e: Event) => { this.authEmail = (e.target as HTMLInputElement).value; }}"
              class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20
                     focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition-all"
              placeholder="you@example.com"
              autocomplete="email"
            />
          </div>

          ${!isLogin ? html`
          <div class="flex flex-col gap-1">
            <label class="text-xs font-bold text-white/40 uppercase tracking-wider">Display Name</label>
            <input
              type="text"
              .value="${this.authDisplayName}"
              @input="${(e: Event) => { this.authDisplayName = (e.target as HTMLInputElement).value; }}"
              class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20
                     focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition-all"
              placeholder="RobustePlayer"
              autocomplete="username"
            />
          </div>` : ""}

          <!-- Password -->
          <div class="flex flex-col gap-1">
            <label class="text-xs font-bold text-white/40 uppercase tracking-wider">Password</label>
            <div class="flex">
              <input
                type="${this.authShowPw ? "text" : "password"}"
                .value="${this.authPassword}"
                @input="${(e: Event) => { this.authPassword = (e.target as HTMLInputElement).value; }}"
                @keydown="${(e: KeyboardEvent) => { if (e.key === "Enter") void this.handleAuthSubmit(); }}"
                class="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-l-xl text-white placeholder-white/20
                       focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition-all"
                placeholder="Password"
                autocomplete="${isLogin ? "current-password" : "new-password"}"
              />
              <button
                type="button"
                class="px-4 bg-white/5 border border-l-0 border-white/10 rounded-r-xl text-white/40 hover:text-white/70 text-xs font-bold uppercase"
                @click="${() => { this.authShowPw = !this.authShowPw; }}"
              >${this.authShowPw ? "Hide" : "Show"}</button>
            </div>
          </div>

          ${this.authError ? html`
          <div class="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">
            ${this.authError}
          </div>` : ""}

          <!-- Submit -->
          <button
            class="w-full py-4 rounded-xl font-bold uppercase tracking-wider text-sm transition-all
              bg-gradient-to-r from-red-700 to-red-600 hover:from-red-600 hover:to-red-500 text-white
              disabled:opacity-40 disabled:cursor-not-allowed"
            ?disabled="${this.authLoading}"
            @click="${() => void this.handleAuthSubmit()}"
          >${this.authLoading ? "..." : (isLogin ? "Sign In" : "Create Account")}</button>

          <!-- Discord divider -->
          <div class="flex items-center gap-3">
            <div class="h-px bg-white/10 flex-1"></div>
            <span class="text-xs text-white/20 uppercase tracking-widest font-bold">or</span>
            <div class="h-px bg-white/10 flex-1"></div>
          </div>

          <!-- Discord -->
          <button
            @click="${() => { discordLogin(); }}"
            class="w-full py-4 flex items-center justify-center gap-3 rounded-xl font-bold tracking-wide
              bg-[#5865F2] hover:bg-[#4752C4] text-white transition-all"
          >
            <img src=${assetUrl("images/DiscordLogo.svg")} alt="Discord" class="w-5 h-5" />
            Login with Discord
          </button>

        </div>
      </div>
    `;
  }

  private async handleAuthSubmit(): Promise<void> {
    this.authError = "";
    const email = this.authEmail.trim();
    const password = this.authPassword;
    const displayName = this.authDisplayName.trim();

    if (!email || !password) { this.authError = "Email and password are required."; return; }
    if (!email.includes("@")) { this.authError = "Please enter a valid email address."; return; }
    if (password.length < 8) { this.authError = "Password must be at least 8 characters."; return; }
    if (this.authMode === "register" && !displayName) { this.authError = "Please enter a display name."; return; }

    const endpointPath = this.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const fallbackEndpoint = `${getApiBase()}${endpointPath}`;
    const body: Record<string, string> = { email, password };
    if (this.authMode === "register") body.displayName = displayName;

    this.authLoading = true;
    try {
      let res = await fetch(endpointPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      // If same-origin route is unavailable in split frontend/API deployments,
      // retry against the configured API host.
      if (res.status === 404 || res.status === 405) {
        res = await fetch(fallbackEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
      }

      const raw = await res.text();
      const data = (raw ? JSON.parse(raw) : {}) as {
        error?: string;
        jwt?: string;
        expiresIn?: number;
      };
      if (!res.ok) { this.authError = data.error ?? "Something went wrong. Please try again."; return; }
      if (typeof data.jwt === "string" && data.jwt.length > 0) {
        setAuthJwt(data.jwt, typeof data.expiresIn === "number" ? data.expiresIn : 3600);
      }
      const userMe = await getUserMe();
      this.userMeResponse = userMe || null;
      this.authPassword = "";
      this.authError = "";
    } catch (error) {
      console.error("Auth request failed", error);
      this.authError = "Unable to reach the server. Check your connection.";
    } finally {
      this.authLoading = false;
    }
  }

  protected onOpen(): void {
    this.isLoadingUser = true;

    void getUserMe()
      .then((userMe) => {
        if (userMe) {
          this.userMeResponse = userMe;
          if (this.userMeResponse?.player?.publicId) {
            this.loadPlayerProfile(this.userMeResponse.player.publicId);
          }
        } else {
          this.userMeResponse = null;
          this.statsTree = null;
          this.recentGames = [];
        }
        this.isLoadingUser = false;
        this.requestUpdate();
      })
      .catch((err) => {
        console.warn("Failed to fetch user info in AccountModal.open():", err);
        this.isLoadingUser = false;
        this.requestUpdate();
      });
    this.requestUpdate();
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private async handleLogout() {
    await logOut();
    this.close();
    window.location.reload();
  }

  private async loadPlayerProfile(publicId: string): Promise<void> {
    try {
      const data = await fetchPlayerById(publicId);
      if (!data) {
        this.requestUpdate();
        return;
      }
      this.recentGames = data.games;
      this.statsTree = data.stats;
      this.requestUpdate();
    } catch (err) {
      console.warn("Failed to load player data:", err);
      this.requestUpdate();
    }
  }
}
