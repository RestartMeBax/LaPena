import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import {
  deleteInventoryCosmetic,
  getUserMe,
  invalidateUserMe,
} from "./Api";
import {
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  getPlayerCosmetics,
  resolveCosmetics,
  ResolvedCosmetic,
  resolvedToPlayerPattern,
} from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("territory-patterns-modal")
export class TerritoryPatternsModal extends BaseModal {
  public previewButton: HTMLElement | null = null;

  @state() private selectedPattern: PlayerPattern | null;
  @state() private selectedColor: string | null = null;
  @state() private search = "";

  private cosmetics: Cosmetics | null = null;
  private userSettings: UserSettings = new UserSettings();
  private userMeResponse: UserMeResponse | false = false;

  private _onPatternSelected = async () => {
    await this.updateFromSettings();
    this.refresh();
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      (event: CustomEvent<UserMeResponse | false>) => {
        this.onUserMe(event.detail);
      },
    );
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onPatternSelected,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onPatternSelected,
    );
  }

  private async updateFromSettings() {
    const cosmetics = await getPlayerCosmetics();
    this.selectedPattern = cosmetics.pattern ?? null;
    this.selectedColor = cosmetics.color?.color ?? null;
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    await this.updateFromSettings();
    this.refresh();
  }

  private includedInSearch(name: string): boolean {
    const displayName = name.replace(/_/g, " ");
    return displayName.toLowerCase().includes(this.search.toLowerCase());
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  private async emitFreshUserMe() {
    invalidateUserMe();
    const next = await getUserMe();
    this.userMeResponse = next;
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: next,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  private async deleteOwnedPattern(resolved: ResolvedCosmetic) {
    if (resolved.type !== "pattern" || resolved.cosmetic === null) return;

    const displayName = resolved.cosmetic.name.replace(/_/g, " ");
    const palette = resolved.colorPalette?.name;
    const label = palette ? `${displayName} (${palette})` : displayName;
    if (!window.confirm(`Delete ${label} from your inventory?`)) {
      return;
    }

    const deleted = await deleteInventoryCosmetic(
      "pattern",
      resolved.cosmetic.name,
      palette,
    );
    if (!deleted) {
      alert("Failed to delete this skin from inventory.");
      return;
    }

    const selectedName = this.selectedPattern?.name ?? null;
    const selectedPalette = this.selectedPattern?.colorPalette?.name ?? null;
    if (
      selectedName === resolved.cosmetic.name &&
      selectedPalette === (palette ?? null)
    ) {
      this.userSettings.setSelectedPatternName(undefined);
      this.selectedPattern = null;
    }

    await this.emitFreshUserMe();
    await this.updateFromSettings();
    this.refresh();
  }

  private renderPatternGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      null,
    ).filter(
      (r) =>
        r.type === "pattern" &&
        r.relationship === "owned" &&
        (r.cosmetic === null
          ? !this.search
          : this.includedInSearch(r.cosmetic.name)),
    );

    return html`
      <div class="flex flex-col">
        <div
          class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
        >
          ${items.map((r) => {
            const isSelected =
              (r.cosmetic === null && this.selectedPattern === null) ||
              (r.cosmetic !== null &&
                this.selectedPattern?.name === r.cosmetic.name &&
                (this.selectedPattern?.colorPalette?.name ?? null) ===
                  (r.colorPalette?.name ?? null));
            return html`
              <div class="relative">
                <cosmetic-button
                  .resolved=${r}
                  .selected=${isSelected}
                  .onSelect=${(rc: ResolvedCosmetic) => this.selectCosmetic(rc)}
                ></cosmetic-button>
                ${r.cosmetic === null
                  ? html``
                  : html`<button
                      class="absolute top-2 right-2 z-20 w-8 h-8 rounded-full border border-red-500/60 bg-black/70 text-red-300 hover:text-white hover:bg-red-600/70 flex items-center justify-center"
                      title="Delete from inventory"
                      @click=${() => this.deleteOwnedPattern(r)}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                        <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM8 9h2v9H8V9z"/>
                      </svg>
                    </button>`}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  render() {
    const content = html`
      <div class="${this.modalContainerClass}">
        <div
          class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
        >
          ${modalHeader({
            title: translateText("territory_patterns.title"),
            onBack: () => this.close(),
            ariaLabel: translateText("common.back"),
            rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
          })}

          <div class="md:flex items-center gap-2 justify-center mt-4">
            <input
              class="h-12 w-full max-w-md border border-white/10 bg-black/60
              rounded-xl shadow-inner text-xl text-center focus:outline-none
              focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-white placeholder-white/30 transition-all"
              type="text"
              placeholder=${translateText("territory_patterns.search")}
              .value=${this.search}
              @change=${this.handleSearch}
              @keyup=${this.handleSearch}
            />
          </div>
        </div>
        <div class="flex justify-center py-3 shrink-0">
          <button
            class="px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer transition-colors"
            @click=${() => {
              this.close();
              window.showPage?.("page-item-store");
            }}
          >
            ${translateText("main.store")}
          </button>
        </div>
        <div
          class="flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent mr-1"
        >
          ${this.renderPatternGrid()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="territoryPatternsModal"
        title="${translateText("territory_patterns.title")}"
        ?inline=${this.inline}
        ?hideHeader=${true}
        ?hideCloseButton=${true}
      >
        ${content}
      </o-modal>
    `;
  }

  protected async onOpen(): Promise<void> {
    await this.refresh();
  }

  protected onClose(): void {
    this.search = "";
  }

  private selectCosmetic(resolved: ResolvedCosmetic) {
    if (resolved.type !== "pattern") return;
    this.selectPattern(resolvedToPlayerPattern(resolved));
  }

  private selectPattern(pattern: PlayerPattern | null) {
    this.selectedColor = null;
    if (pattern === null) {
      this.userSettings.setSelectedPatternName(undefined);
    } else {
      const name =
        pattern.colorPalette?.name === undefined
          ? pattern.name
          : `${pattern.name}:${pattern.colorPalette.name}`;
      this.userSettings.setSelectedPatternName(`pattern:${name}`);
    }
    this.selectedPattern = pattern;
    this.refresh();
    this.showSkinSelectedPopup();
    this.close();
  }

  private showSkinSelectedPopup() {
    let skinName = translateText("territory_patterns.pattern.default");
    if (this.selectedPattern && this.selectedPattern.name) {
      skinName = this.selectedPattern.name
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      if (
        this.selectedPattern.colorPalette &&
        this.selectedPattern.colorPalette.name
      ) {
        skinName += ` (${this.selectedPattern.colorPalette.name})`;
      }
    }
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: `${skinName} ${translateText("territory_patterns.selected")}`,
          duration: 2000,
        },
      }),
    );
  }

  public async refresh() {
    this.requestUpdate();
  }
}
