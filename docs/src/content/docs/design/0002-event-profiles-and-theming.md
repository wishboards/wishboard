---\ntitle: 0002 Event Profiles And Theming\n---\n# Design Document 0002: Event Profiles and Decoupled Theming (Issue #263)

## Context & Vision

Wishboard is a disconnected wish board designed to run on local hardware (Raspberry Pi kiosk) or serverless infrastructure (AWS Lambda) for various events. Previous versions bundled domain configuration files (`defaultDomain.yaml`) within the source code, hardcoded CSS color definitions directly in `styles.css`, and maintained fallback UI categories (Gender, Orientation, Role) in React state.

This design establishes a total separation of concerns between core application logic, event configuration, and visual theming.

## Key Concepts

### 1. Event Profiles (`/profiles/`)

Instead of hardcoding convention identities or configurations in the backend/frontend, all event specifics live in `/profiles/<profile_name>/`:

- `profile.yaml`: Defines event categories, suggestion pills, dynamic contact methods (`contact_methods`), sticker mappings, and rule seeds.
- `theme.css`: Defines native CSS variables (`--header-bg`, `--app-bg`, `--card-bg`, etc.) for visual customization.
- `assets/`: Custom logo and sticker assets specific to the event.

Currently provided profiles:

- `lifestyle`: Designed for lifestyle, swinging, and BDSM conventions (replaces legacy default domain).
- `professional`: Designed for corporate and professional networking conferences (replaces legacy conference domain).

### 2. Native CSS Variable Strategy

Base application layout styles (`styles.css`) define flexbox layouts, grid gaps, typography structure, and responsive rules, referencing CSS variables with safe defaults.
The active profile's `theme.css` is injected via `<link rel="stylesheet" href="/theme.css">` at build time to define the `:root` variables. No structural CSS is duplicated or clobbered.

### 3. Deploy-Time Safety & Fast Failure

CLI deployment tools (`build.js`, `kiosk.js`, `serverless.js`, `post-build.js`) accept an `--event-profile <name>` flag (defaulting to `lifestyle`). If the profile path `/profiles/<name>/` does not exist, the build/deployment script aborts immediately with a descriptive error.

### 4. Dynamic Contact Methods

`profile.yaml` contains `contact_methods: ['FetLife', 'Phone', 'Email']` (or `['LinkedIn', 'Phone', 'Email']`). The `ContactEditor.tsx` component pulls options dynamically from `EventProfileContext`, ensuring event-appropriate options are presented without hardcoding.

## Architecture

```
/profiles/
  ├── lifestyle/
  │   ├── profile.yaml
  │   ├── theme.css
  │   └── assets/
  └── professional/
      ├── profile.yaml
      ├── theme.css
      └── assets/
```
