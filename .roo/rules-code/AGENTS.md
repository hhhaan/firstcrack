# Code Mode AGENTS.md (Non-Obvious Only)

- Prefer const arrow functions for components/handlers (project convention, e.g. History.tsx)
- React 19: useMemo for filtering/sorting in views/History.tsx pattern
- Tailwind v4 via @tailwindcss/vite: Custom shadows (shadow-ring, shadow-inset, shadow-card)
- Tauri IPC: Use @tauri-apps/api (v2), capabilities restrict commands
- Device configs: JSON schemas in sidecar/config/devices/, not TS types
- No ESLint/Prettier: Manual TS strict + Tailwind prose
