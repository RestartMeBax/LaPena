import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { getUserMe } from "../Api";
import { NavNotificationsController } from "./NavNotificationsController";

@customElement("desktop-nav-bar")
export class DesktopNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);
  private _isAdmin = false;
  private _adminCheckInterval: number | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);

    // Check if user is admin
    this._checkAdminStatus();
    
    // Re-check admin status every 5 seconds in case user logs in
    this._adminCheckInterval = window.setInterval(() => {
      this._checkAdminStatus();
    }, 5000);

    const current = window.currentPageId;
    if (current) {
      // Wait for render
      this.updateComplete.then(() => {
        this._updateActiveState(current);
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
    if (this._adminCheckInterval !== null) {
      window.clearInterval(this._adminCheckInterval);
      this._adminCheckInterval = null;
    }
  }

  private async _checkAdminStatus() {
    const userMe = await getUserMe();
    const wasAdmin = this._isAdmin;
    const email = userMe && userMe.user.email ? userMe.user.email : "NO_EMAIL";
    console.log("[DesktopNavBar] Admin check - email:", email, "userMe:", userMe);
    this._isAdmin = !!(userMe && userMe.user.email === "ludovickjeux@gmail.com");
    console.log("[DesktopNavBar] Admin status:", this._isAdmin, "was:", wasAdmin);
    if (this._isAdmin !== wasAdmin) {
      console.log("[DesktopNavBar] Admin status changed, requesting update");
      this.requestUpdate();
    }
  }

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <nav
        class="hidden lg:flex w-full bg-zinc-900/90 backdrop-blur-md items-center justify-center gap-8 py-4 shrink-0 z-50 relative"
      >
        <div class="flex flex-col items-center justify-center">
          <div class="h-28 text-[#0073b7] flex items-center justify-center">
            <img
              src=${assetUrl("images/RobusteLogo.svg")}
              alt="Robuste"
              class="h-full w-auto max-w-full object-contain"
            />
          </div>
          <div
            id="game-version"
            class="l-header__highlightText text-center"
          ></div>
        </div>
        <button
          class="nav-menu-item ${currentPage === "page-play"
            ? "active"
            : ""} text-white/70 hover:text-[#0073b7]  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-[#0073b7] "
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        <!-- Desktop Navigation Menu Items -->
        <div class="relative">
          <button
            class="nav-menu-item ${currentPage === "page-news"
              ? "active"
              : ""} text-white/70 hover:text-[#0073b7]  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-[#0073b7] "
            data-page="page-news"
            data-i18n="main.news"
            @click=${this._notifications.onNewsClick}
          ></button>
          ${this._notifications.showNewsDot()
            ? html`
                <span
                  class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"
                ></span>
                <span
                  class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"
                ></span>
              `
            : ""}
        </div>
        <div class="relative no-crazygames">
          <button
            class="nav-menu-item ${currentPage === "page-item-store"
              ? "active"
              : ""} text-white/70 hover:text-[#0073b7]  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-[#0073b7] "
            data-page="page-item-store"
            data-i18n="main.store"
            @click=${this._notifications.onStoreClick}
          ></button>
          ${this._notifications.showStoreDot()
            ? html`
                <span
                  class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"
                ></span>
                <span
                  class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"
                ></span>
              `
            : ""}
        </div>
        <button
          class="nav-menu-item text-white/70 hover:text-[#0073b7]  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-[#0073b7] "
          data-page="page-settings"
          data-i18n="main.settings"
        ></button>
        <button
          class="nav-menu-item text-white/70 hover:text-[#0073b7]  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-[#0073b7] "
          data-page="page-leaderboard"
          data-i18n="main.leaderboard"
        ></button>
        <div class="relative">
          <button
            class="nav-menu-item text-white/70 hover:text-[#0073b7]  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-[#0073b7] "
            data-page="page-help"
            data-i18n="main.help"
            @click=${this._notifications.onHelpClick}
          ></button>
          ${this._notifications.showHelpDot()
            ? html`
                <span
                  class="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full animate-ping"
                ></span>
                <span
                  class="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full"
                ></span>
              `
            : ""}
        </div>
        ${this._isAdmin
          ? html`
              <button
                class="nav-menu-item text-white/70 hover:text-[#fbbf24]  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-[#fbbf24]"
                data-i18n="main.admin"
                @click=${() => (window.location.href = "/admin.html")}
              >ADMIN</button>
            `
          : ""}
        <button
          id="nav-account-button"
          class="no-crazygames nav-menu-item relative h-10 rounded-full overflow-hidden flex items-center justify-center gap-2 px-3 bg-transparent border border-white/20 text-white/80 hover:text-white cursor-pointer transition-colors [&.active]:text-white"
          data-page="page-account"
          data-i18n-aria-label="main.account"
          data-i18n-title="main.account"
        >
          <img
            id="nav-account-avatar"
            class="no-crazygames hidden w-8 h-8 rounded-full object-cover"
            alt=""
            data-i18n-alt="main.discord_avatar_alt"
            referrerpolicy="no-referrer"
          />
          <svg
            id="nav-account-person-icon"
            class="w-5 h-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M20 21a8 8 0 0 0-16 0" />
            <path d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
          </svg>
          <span
            id="nav-account-email-badge"
            class="hidden absolute bottom-1 right-1 w-4 h-4 rounded-full bg-slate-900/80 border border-white/20 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg
              class="w-2.5 h-2.5 text-white/80"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M4 4h16v16H4z" opacity="0" />
              <path d="M4 6h16v12H4z" />
              <path d="m4 7 8 6 8-6" />
            </svg>
          </span>
          <span
            id="nav-account-signin-text"
            class="max-w-[12rem] truncate text-xs font-semibold tracking-wide"
            data-i18n="main.sign_in"
          >
          </span>
        </button>
      </nav>
    `;
  }
}
