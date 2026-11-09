---
title: Hardware & Companion UX Validation Matrix
description: Persona-driven manual test matrix for physical hardware and companion mobile devices in Kiosk Mode.
---

## 1. Scope & Physical Setup

- **Scope:** Post-Release v1.35.0 Physical Validation & Pre-Phase 4 Sign-Off
- **Hardware Setup:** Raspberry Pi 4 (Dual Mode: HDMI Kiosk Display + Wi-Fi Hotspot)
- **Client Devices:** Physical Mobile Phone (iOS Safari / Android Chrome) + Local HDMI Screen

---

## 2. Why Manual Testing is Essential

While unit tests (118 test suites, 1,178 tests) and Playwright E2E suites validate core DOM logic and responsive layouts, automated browser environments (headless Chromium/WebKit) simulate mobile environments imperfectly. The following physical phenomena can only be truly verified on real hardware:

1. **Virtual Software Keyboard vs. Viewport:** How iOS Safari and Android Chrome resize `100dvh` and fixed elements (`MobileBottomBar` and `<BottomSheet>`) when the on-screen keyboard appears.
2. **Capacitive Touch Dynamics & Inertia:** Dragging, flicking, and velocity-based sheet dismissal on real glass with human thumb ergonomics.
3. **Hardware Camera Stream & Lighting:** WebRTC camera initialization, lens autofocus, paper card edge detection, and Tesseract OCR under ambient room lighting.
4. **Captive Network Assistant (CNA) & Local DNS:** How Apple Captive Network Assistant and Android Network Validation handle the Pi's local `wishboard.local` redirect without upstream internet.
5. **Real-Time Dual-Screen Synchronization:** Verifying that a wish submitted from a phone in the attendee's hand appears on the big HDMI corkboard display via local WebSocket in under 500ms without page reload.

---

## 3. Test Environment Setup (Raspberry Pi Dual Mode)

1. Deploy dual-mode stack to local Raspberry Pi:
   ```bash
   npx wishboard kiosk deploy --mode dual --host raspberrypi.local --user pi
   ```
2. Verify hardware state:
   - **HDMI Screen:** Boots into fullscreen Chromium displaying `http://localhost:3000/display` (the corkboard).
   - **Wi-Fi Hotspot:** Broadcasting SSID `Wishboard_WiFi` (or configured event SSID).
   - **Mobile Client:** Disconnect from cellular data / home Wi-Fi; connect to `Wishboard_WiFi` hotspot.

---

## 4. Persona-Driven Test Matrix

### Persona A: Anonymous Attendee & Wish Creator

_Goal: Fast, friction-free tactile wish creation with zero account setup._

| ID      | Test Scenario                                         | Steps to Execute                                                                                                                                                                                                                                                                                                                                                                                   | Expected Physical Result                                                                                                                                                                                                                                                                                                    | Pass/Fail |
| ------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------: |
| **A-1** | **Hotspot Connect & QR Onboarding**                   | 1. Connect phone to `Wishboard_WiFi`.<br />2. Observe captive portal or scan Wi-Fi/Board QR on HDMI display.                                                                                                                                                                                                                                                                                       | Phone opens browser directly to `http://wishboard.local` (or `10.42.0.1:3000`). No SSL warning or blocking screen.                                                                                                                                                                                                          |    [ ]    |
| **A-2** | **Mobile Thumb Zone Navigation**                      | 1. Navigate through bottom tabs: `Home` (`🏠`), `Post` (`✍️`), `Search` (`🔍`), `Inbox` (`📬`), `Account` (`👤`).                                                                                                                                                                                                                                                                                  | Bottom navigation bar stays anchored above iOS Home Indicator; no "Board" tab present on mobile; active tab indicator updates instantly.                                                                                                                                                                                    |    [ ]    |
| **A-3** | **Enter Wish & Tactile Personalization**              | 1. Tap `Post` tab.<br />2. Type a wish text.<br />3. Select Paper Tint (`Canary`) and Pushpin (`Ruby`).<br />4. Inspect Live Preview card.                                                                                                                                                                                                                                                         | Preview renders tactile textured paper, subtle drop shadow, and 3D pushpin radial highlight. Preview scales correctly without overflowing screen width.                                                                                                                                                                     |    [ ]    |
| **A-4** | **Attribute Drawer (`BottomSheet`) Touch & Velocity** | 1. Tap the "Creator Attributes" summary pill.<br />2. Verify drawer slides smoothly from bottom.<br />3. Drag handle down slowly past 50% threshold.<br />4. Repeat, but flick quickly downward from top.                                                                                                                                                                                          | Sheet tracks finger 1:1 without stutter. Slow drag past halfway dismisses sheet; quick flick dismisses even if released near top.                                                                                                                                                                                           |    [ ]    |
| **A-5** | **Virtual Keyboard & Input Focus**                    | 1. In attribute drawer, tap an attribute input.<br />2. Type tags (e.g. `cosplayer, photographer`).<br />3. Dismiss keyboard by tapping "Done".                                                                                                                                                                                                                                                    | Drawer adjusts smoothly when keyboard pops up; input remains visible; dismissing keyboard restores viewport cleanly without blank space.                                                                                                                                                                                    |    [ ]    |
| **A-6** | **Anonymous Wish Submission & Passphrase**            | 1. Tap "Pin to Board".<br />2. Observe confirmation & passphrase modal.                                                                                                                                                                                                                                                                                                                            | Confirmation modal appears with generated code phrase. Passphrase copy button works.                                                                                                                                                                                                                                        |    [ ]    |
| **A-7** | **Guest Wish Contacts & Wishmail Form Layout**        | 1. Tap `Post` tab on mobile device.<br />2. Inspect Contacts & Wishmail section in both light and dark theme modes.<br />3. Tap "Enable Wishmail" checkbox or its label.<br />4. Tap "+ Add Contact Method", select contact method, and enter handle.<br />5. Verify no text is obscured by white boxes and inputs fit within mobile viewport.<br />6. Submit wish and inspect confirmation modal. | Text and controls render with high contrast using theme surface tokens; no unstyled white boxes obscuring content. Checkbox is easily tappable with clear accessible text label. Contact dropdown and input fit mobile viewport without horizontal scrolling or clipping. Wish is saved with contacts and wishmail enabled. |    [ ]    |

---

### Persona B: Authenticated Attendee (Persistent Identity & Matching)

_Goal: Account management, segmented profile setup, and private matchmaking._

| ID      | Test Scenario                                                  | Steps to Execute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Expected Physical Result                                                                                                                                                                                        | Pass/Fail |
| ------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------: |
| **B-1** | **Account Debounce & Dynamic Mode Switch (Login vs Register)** | 1. Tap `Account` tab. Observe single unified form without duplicate `[ Login ] [ Register ]` tabs.<br />2. Type a new unregistered username. Observe that form defaults to Registration mode (passphrase guide and identity inputs visible).<br />3. Enter passphrase and tap "Register" to create account.<br />4. In `Appearance & Security`, tap "Log out".<br />5. Tap `Account` tab again and type the registered username.<br />6. Observe that within 250ms of typing, the form dynamically transitions to Login mode (submit button becomes "Login", registration fields hide).<br />7. Enter passphrase and tap "Login". | Seamless transition between login and register without manual tab selection. 250ms debounce queries username existence smoothly without input flicker. User is authenticated and redirected to 3-tab dashboard. |    [ ]    |
| **B-2** | **Segmented Tab Navigation & Draft Preservation**              | 1. Go to `Identity & Match` tab.<br />2. Enter changes into role/gender fields (do NOT click save).<br />3. Switch to `Appearance & Security` tab.<br />4. Switch back to `Identity & Match`.                                                                                                                                                                                                                                                                                                                                                                                                                                     | Tab transitions smoothly with zero full-page reload; unsaved draft values remain intact in fields.                                                                                                              |    [ ]    |
| **B-3** | **Appearance & Theme Switching on Device**                     | 1. In `Appearance & Security`, switch theme mode: `System` -> `Light` -> `Dark`.<br />2. Toggle High Contrast mode if available.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | UI background, bottom bar, text, and drawer borders immediately update theme palette without flickering.                                                                                                        |    [ ]    |
| **B-4** | **Wishmail / Direct Contact Management**                       | 1. Add a contact handle (e.g., Discord or Telegram).<br />2. Save changes.<br />3. Verify success banner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Green toast/banner appears. Value persists upon hard refresh of browser.                                                                                                                                        |    [ ]    |

---

### Persona C: Wish Searcher & Match Fulfiller

_Goal: Quick browsing and filtering of posted wishes on a mobile companion._

| ID      | Test Scenario                                   | Steps to Execute                                                                                                                           | Expected Physical Result                                                                                                                         | Pass/Fail |
| ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | :-------: |
| **C-1** | **Mobile Filter Drawer**                        | 1. Tap `Search` tab.<br />2. Tap "Filter Wishes" pill.<br />3. Toggle attributes or search keywords in drawer.<br />4. Tap "Show Results". | Drawer smoothly closes; wish grid filters in place; empty state or match count displays accurately.                                              |    [ ]    |
| **C-2** | **Card Inspection & Flip Interaction**          | 1. Tap any 3×5 wish card in search results.<br />2. Inspect expanded card dialog / flip behavior.<br />3. Tap backdrop to dismiss.         | Card displays author's chosen paper tint, pin accent, and creator attributes. Backdrop tap closes dialog without triggering elements underneath. |    [ ]    |
| **C-3** | **Orientation Change (Portrait <-> Landscape)** | 1. Rotate phone from portrait to landscape.<br />2. Inspect Bottom Sheet or Search page.                                                   | Bottom navigation bar adjusts gracefully or adapts; bottom sheet content does not get clipped offscreen; scrolling is smooth.                    |    [ ]    |

---

### Persona D: Physical Kiosk Attendee & Dual-Screen Sync

_Goal: Zero-latency convergence between personal mobile device and the public HDMI corkboard._

| ID      | Test Scenario                                  | Steps to Execute                                                                                                                                                          | Expected Physical Result                                                                                                                         | Pass/Fail |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | :-------: |
| **D-1** | **Live Dual-Screen WebSocket Synchronization** | 1. Keep eyes on the physical HDMI monitor running the corkboard.<br />2. On mobile phone, post a new wish with `Canary` paper and `Ruby` pin.<br />3. Hit "Pin to Board". | Within 500ms, the new card physically appears on the HDMI screen with the exact chosen paper tint and pin color, without refreshing the display. |    [ ]    |
| **D-2** | **Physical Screen Touch / Kiosk Interaction**  | 1. If HDMI display has touchscreen or mouse connected, tap/click a wish card on the big screen.                                                                           | Card zooms or shows details without crashing or displaying browser navigation chrome.                                                            |    [ ]    |
| **D-3** | **Network Drop & Reconnection Recovery**       | 1. Put phone in Airplane Mode for 10 seconds.<br />2. Turn Airplane Mode off (reconnects to `Wishboard_WiFi`).                                                            | WebSocket connection recovers automatically; no stuck loading spinners; search results stay interactive.                                         |    [ ]    |

---

### Persona E: Event Administrator

_Goal: On-site moderation, audit, and system oversight._

| ID      | Test Scenario                                 | Steps to Execute                                                                                                                       | Expected Physical Result                                                                                   | Pass/Fail |
| ------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | :-------: |
| **E-1** | **Admin Access on Mobile**                    | 1. Open `/login` and sign in with admin credentials.<br />2. Navigate to `/admin`.                                                     | Responsive admin layout loads cleanly; metrics summary cards stack vertically without horizontal overflow. |    [ ]    |
| **E-2** | **Content Moderation & Flagged Wishes**       | 1. From an attendee phone, flag an inappropriate wish.<br />2. On Admin page, check Moderation queue.<br />3. Delete or hide the wish. | Wish immediately disappears from the HDMI corkboard and attendee search view in real time.                 |    [ ]    |
| **E-3** | **System Diagnostics & Local Resource Check** | 1. Check system metrics card on Admin page.                                                                                            | Local SQLite WAL size, connected WebSocket clients count, and uptime report realistic numbers.             |    [ ]    |

---

## 5. Event Host Door-Opening Protocol

Convention and event hosts should execute the following 5-minute smoke pass before opening event doors:

1. **Power Cycle Check:** Power on Raspberry Pi and confirm HDMI monitor reaches `/display` within 90 seconds.
2. **SSID Broadcast Check:** Confirm `Wishboard_WiFi` is visible on a staff device.
3. **Smoke Post:** Execute test case `D-1` (post one canary card with ruby pin) and confirm it appears on the big screen.
4. **Clear Flag Check:** Verify admin login works from phone and delete the test wish.
