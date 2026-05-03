# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Tauri v2 Integration (Non-Standard)

- Frontend dev server fixed on localhost:1420 (vite.config.ts), HMR:1421
- Tauri devUrl: http://localhost:1420, frontendDist: ../dist
- Capabilities: src-tauri/capabilities/default.json (permissions)
- Ignore src-tauri/\*\* in Vite watch

## Python Sidecar (Device Layer)

- sidecar/server.py + drivers/ (MQTT, Modbus, Phidget, RoestSampleRoaster)
- Configs: sidecar/config/devices/_/_.json

## UI Structure

- src/views/: Page components (History.tsx, ActiveRoast.tsx)
- src/widgets/: Modals/sidebar (add-bean-modal/, active-roast/)
- src/shared/ui/: Reusable primitives (modal-shell/)

## Design Gotchas (DESIGN.md)

- Multi-layer low-opacity shadows (<0.1), warm-tinted (rgba(78,50,23,0.04))
- Headings: Waldenburg 300wt (light), Inter body +0.14px tracking
- No emojis (use Lucide icons), pill buttons (9999px radius)
- shadcn/ui theme vars in DESIGN.md
- Use tailwindcss utility classes instead of style prop

## No Tests/Linting

- No test framework or lint configs found
