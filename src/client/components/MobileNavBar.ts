import { html, LitElement, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { getUserMe } from "../Api";
import { NavNotificationsController } from "./NavNotificationsController";

@customElement("mobile-nav-bar")
export class MobileNavBar extends LitElement {
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
    const email = (userMe && userMe.user.email ? userMe.user.email : "").toLowerCase();
    const roles = userMe && userMe.player?.roles ? userMe.player.roles : [];
    this._isAdmin = roles.includes("admin") || email === "ludovickjeux@gmail.com";
    console.log("[MobileNavBar] Admin status:", this._isAdmin, "was:", wasAdmin);
    if (this._isAdmin !== wasAdmin) {
      console.log("[MobileNavBar] Admin status changed, requesting update");
      this.requestUpdate();
    }
  }

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      const inner = el.querySelector("button");
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
        inner?.classList.add("active");
      } else {
        el.classList.remove("active");
        inner?.classList.remove("active");
      }
    });
  }

  private _renderDot(color: string): TemplateResult {
    return html`<span class="relative ml-2 shrink-0 -mt-2 w-2 h-2">
      <span class="absolute inset-0 ${color} rounded-full animate-ping"></span>
      <span class="absolute inset-0 ${color} rounded-full"></span>
    </span>`;
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <!-- Border Segments (Custom right border with gap for button) -->
      <div
        class="absolute right-0 top-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>
      <div
        class="absolute right-0 bottom-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>

      <div
        class="flex-1 w-full flex flex-col justify-start overflow-y-auto lg:pt-[clamp(1rem,3vh,4rem)] lg:pb-[clamp(0.5rem,2vh,2rem)] lg:px-[clamp(1rem,1.5vw,2rem)] p-5 gap-[clamp(1rem,3vh,3rem)]"
      >
        <!-- Logo + Menu -->
        <div
          class="flex flex-col text-[#0073b7] mb-[clamp(1rem,2vh,2rem)]"
        >
          <div class="flex flex-col items-center gap-2">
            <div class="h-18 flex items-center justify-center w-full">
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
        </div>
        <!-- Mobile Navigation Menu Items -->
        <button
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] ${currentPage ===
          "page-play"
            ? "active"
            : ""}"
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        <div
          class="nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-news"
          @click=${this._notifications.onNewsClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
            data-i18n="main.news"
          ></button>
          ${this._notifications.showNewsDot()
            ? this._renderDot("bg-red-500")
            : ""}
        </div>
        <button
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-leaderboard"
          data-i18n="main.leaderboard"
        ></button>
        <div
          class="no-crazygames nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-item-store"
          @click=${this._notifications.onStoreClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
            data-i18n="main.store"
          ></button>
          ${this._notifications.showStoreDot()
            ? this._renderDot("bg-red-500")
            : ""}
        </div>
        <button
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-settings"
          data-i18n="main.settings"
        ></button>
        <button
          class="no-crazygames nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-account"
          data-i18n="main.account"
        ></button>
        ${this._isAdmin
          ? html`
              <button
                class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-yellow-500 transition-all duration-200 cursor-pointer hover:text-yellow-400 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(251,191,36,0.5)] [&.active]:text-yellow-400 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(251,191,36,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
                data-i18n="main.admin"
                @click=${() => (window.location.href = "/admin.html")}
              >ADMIN</button>
            `
          : ""}
        <div
          class="nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-help"
          @click=${this._notifications.onHelpClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
            data-i18n="main.help"
          ></button>
          ${this._notifications.showHelpDot()
            ? this._renderDot("bg-yellow-400")
            : ""}
        </div>
        <div
          class="flex flex-col w-full mt-auto [.in-game_&]:hidden items-end justify-end pt-4 border-t border-white/10"
        ></div>
      </div>
    `;
  }
}
