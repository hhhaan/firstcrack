# Debug Mode AGENTS.md (Non-Obvious Only)

- Tauri logs: `tauri dev` terminal + Rust console in VSCode Debug
- Python sidecar: Run `python sidecar/server.py` separately, logs to stdout
- Vite HMR port 1421 (not 5173), clearScreen: false hides Rust errors
- Device drivers: sidecar/drivers/ - test with mock MQTT/Phidget
