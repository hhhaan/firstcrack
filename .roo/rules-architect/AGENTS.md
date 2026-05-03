# Architect Mode AGENTS.md (Non-Obvious Only)

- FSD 지향 (views/widgets/shared 구조), 과도한 추상화 피함, SRP 준수
- Tauri frontend/backend split: React UI + Rust core + Python sidecar (devices)
- Capabilities cmd restrictions: src-tauri/capabilities/default.json
- UI monorepo-like: views/ pages, widgets/ modals, shared/ui primitives
- Device layer: Abstracted via sidecar (MQTT/Modbus), not direct Rust
