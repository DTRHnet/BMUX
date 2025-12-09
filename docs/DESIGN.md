# BMUX: Browser Multiplexer Design Document

## 1. Overview
BMUX is a cross-browser extension designed to bring the functionality of TMUX (Terminal Multiplexer) to the web browser. It allows users to manage multiple browsing contexts (panes) within a single window, organize them into windows and sessions, and control them via keyboard shortcuts and scripting.

## 2. TMUX to BMUX Mapping

| TMUX Concept | BMUX Equivalent | Implementation Strategy |
|--------------|-----------------|-------------------------|
| **Server** | Background Script | Service worker (MV3) managing global state (sessions, windows, panes) and persistence. |
| **Client** | Content Script / UI | Scripts injected into the active tab to render the BMUX overlay/UI and capture hotkeys. |
| **Session** | Browser Session Group | A persistent JSON object in `browser.storage.local` defining a collection of Windows. |
| **Window** | Virtual Tab/View | A logical grouping of Panes. Represented visually as a full-screen container in the active browser tab. |
| **Pane** | Web Frame | An `<iframe>` (or similar container) displaying a URL. *Note: Limited by `X-Frame-Options`.* |
| **Prefix Key** | `Ctrl+b` | Captured via `keydown` listener in Content Script. |
| **Status Line**| Bottom Bar | Fixed `div` at the bottom of the BMUX overlay showing session info. |
| **Command Mode**| Command Prompt | An input overlay (`Ctrl+b :`) to type BMUX commands. |

## 3. Architecture

### 3.1 Background Script (The Server)
- **Role**: Source of truth.
- **State**:
  ```json
  {
    "sessions": {
      "0": {
        "name": "dev",
        "windows": {
          "0": {
            "name": "code",
            "layout": "tiled",
            "panes": [
              { "id": 0, "url": "http://localhost:3000" },
              { "id": 1, "url": "https://docs.mdn.org" }
            ]
          }
        },
        "activeWindow": "0"
      }
    },
    "activeSession": "0"
  }
  ```
- **Communication**: Uses `browser.runtime.onMessage` to receive commands from Content Scripts (Clients).

### 3.2 Content Script (The Client)
- **Role**: Render the UI and capture input.
- **Components**:
  - `Overlay`: A top-level `div` (Shadow DOM) injected into the current tab to hold BMUX.
  - `Grid System`: CSS Grid/Flexbox to render panes based on the layout state.
  - `Input Handler`: Listens for `Ctrl+b` sequence.
  - `Command Prompt`: UI for executing textual commands.

### 3.3 Popup
- Minimal UI for "Attaching" to a BMUX session if not currently active.

## 4. Key Bindings (Proposed Defaults)
- `Ctrl+b c`: Create new window.
- `Ctrl+b %`: Split pane horizontal (left/right).
- `Ctrl+b "`: Split pane vertical (top/bottom).
- `Ctrl+b x`: Kill pane.
- `Ctrl+b n`: Next window.
- `Ctrl+b p`: Previous window.
- `Ctrl+b d`: Detach client (hide overlay).
- `Ctrl+b :`: Command mode.

## 5. Limitations & Adaptations
- **Iframe Restrictions**: Many sites (Google, GitHub, etc.) set `X-Frame-Options: DENY`.
  - *Mitigation*: BMUX will work best for local development, documentation sites, and internal tools that allow framing.
  - *Future Work*: Investigate `webview` (if moving to an App) or specialized headers stripping (requires aggressive permissions, might violate store policies). For now, we accept the limitation.
- **Shortcuts**: Browser reserved shortcuts (Ctrl+T, Ctrl+W) cannot be overridden easily in all contexts. BMUX relies on the page having focus.

## 6. Development Plan
1. **Core**: Manifest, Background Script (State), Content Script (Injection).
2. **Panes**: Implement splitting logic and Iframe rendering.
3. **Commands**: Implement the Command Parser and Hotkey listener.
4. **Storage**: Persist state to `storage.local`.
