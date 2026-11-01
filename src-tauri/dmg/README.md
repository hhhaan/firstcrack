# macOS installer background

`dmg-background.svg` is the editable source for the approved white installer design.
`dmg-background.png` is the bundled export: 1600 × 1000 pixels at 144 DPI, displayed
at 800 × 500 points. Keep the DPI metadata when exporting or optimizing it.
The `lint-staged` image rule excludes `dmg-background` assets because its PNG
optimizer strips DPI metadata, which would change the displayed size in Finder.

Render the SVG on macOS at 2× resolution, cropped to the SVG bounds. Set the
export's resolution with `sips -s dpiWidth 144 -s dpiHeight 144 dmg-background.png`.
The committed PNG keeps release builds independent of fonts and renderers.

Only the logo, headline, and arrow belong in the background; there is no
installation instruction or footer copy. Finder supplies the draggable app,
Applications shortcut, and their labels. Their positions live in `bundle.macOS.dmg`
in `tauri.conf.json`.
The initial window is 800 × 600 points, allowing 100 points above the background
height for Finder's native title, tab, and status bars without clipping the design.
Copy has no sentence-ending periods and does not switch with the user's locale.

The release workflow sets `TAURI_BUNDLER_DMG_IGNORE_CI=true` so Tauri runs its
Finder customization on macOS CI rather than skipping the background and layout.

To verify packaging with an existing debug build, without signing or publishing:

```sh
CI=true TAURI_BUNDLER_DMG_IGNORE_CI=true pnpm tauri bundle --debug --bundles dmg --no-sign --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Open the resulting DMG in Finder and check the background scale, icon alignment,
and legibility. Do not install or launch the app just to verify the layout.
