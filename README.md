# nzs234-ui

Training WebUI for [Lulynx Trainer](https://github.com/WhitecrowAurora/lulynx-trainer),
packaged as a `ui_theme` plugin. Three themes (Editorial / Acid / Glass), served
by the trainer backend at `/ui/`.

## UI Versions (V1 / V2)

The topbar's right corner has a `V1 | V2` switch (also in the mobile drawer).
V1 is the original topbar layout with the three selectable themes; V2 ("NOVA
cockpit") is a full reskin: dark aurora palette, fixed left navigation rail, a
floating glass HUD in the top-right, glassmorphism panels, pill buttons/tabs
and gradient display type. Both versions share the same pages, stores and
business logic — the switch only swaps the skin (`html[data-uiv]` +
`src/theme/v2/v2.css`, persisted in `localStorage["lx-uiversion"]`), so no
functionality differs between them. The V2 palette is fixed by design, so the
theme selector only shows in V1.

## Install

Clone into the trainer's `plugin/` directory and build the frontend:

```sh
git clone https://github.com/nzs234/nzs234-ui.git <trainer>/plugin/nzs234-ui
cd <trainer>/plugin/nzs234-ui/ui
npm ci
npm run build          # writes ui/dist, which is not tracked in git
```

Then activate it in the launcher under Extensions → Frontend UI Plugins, or set
it directly and restart the backend:

- `backend/config/ui_profiles/active.json` → `"active_profile_id": "community:nzs234-ui"`
- `backend/lulynx_settings.json` → `"active_ui_plugin": "nzs234.ui_theme.nzs234_ui"`

`/ui/` is mounted once at backend startup, so a switch always needs a restart.

## Identity

| File | Field | Value |
| --- | --- | --- |
| `manifest.json` | `id` | `community:nzs234-ui` (launcher profile inventory) |
| `plugin_manifest.json` | `id` | `nzs234.ui_theme.nzs234_ui` (plugin runtime) |

Both must be present: the launcher scans `manifest.json` to list the profile,
and the backend reads `plugin_manifest.json` to resolve `ui_theme_metadata.dist_dir`.

## Development

```sh
cd ui
npm run dev            # vite on :3010, proxies /api /train /ws to :28000
npm test               # vitest
npm run test:typecheck # tsc over tests
npm run parity         # schema parity against tools/.schema-parity-baseline.json
```

The dev server expects the trainer backend on `127.0.0.1:28000`.

## License

PolyForm Noncommercial 1.0.0 — see the SPDX headers in `ui/src`.
