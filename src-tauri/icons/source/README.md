# App icon artwork

`app-icon.png` is the original 1254 × 1254 artwork for P99 Mobile Chat, generated
with the built-in image-generation tool. It is the source for all launcher,
desktop, and browser icons. The opaque square has no outer app-tile mask;
platforms apply their own shapes.

From the repository root, after `npm ci`:

```sh
npm run icons:generate
```

This uses Tauri's installed icon generator to replace the desktop, Android,
and iOS sizes in `src-tauri/icons/` and the browser favicon in `public/icon.png`.
The Android foreground wrapper keeps the mark within adaptive launcher masks.
`icon.json` sets the matching dark background color. The iOS images are opaque.
The notification's small monochrome chat glyph is a separate Android resource.

Generation also updates initialized Android and iOS projects. Tauri's development
and build hooks run `npm run icons:sync` to copy committed icons into generated
projects, so a fresh platform initialization uses the same artwork. Regenerating
icons needs no image-generation service or API key.

See [Tauri's icon documentation](https://v2.tauri.app/develop/icons/).

## Original generation prompt

Use case: logo-brand. Asset type: production mobile application icon master for
P99 Mobile Chat, an unofficial classic EverQuest Project 1999 chat client. Create
one polished square icon image, not a mockup or presentation sheet. A single bold
chat-bubble emblem containing the exact text "P99", with restrained classic fantasy
serif lettering, warm muted gold on a very dark charcoal background with a subtle
deep forest green undertone. Minimal, functional, mature design: simple strong
silhouette, thick sturdy letterforms, generous negative space, clear at 48 pixels.
The speech bubble and lettering should feel like one cohesive mark, with one short
unmistakable speech tail. Almost flat artwork with only very restrained depth; no
tiny ornament, runes, swords, dragon, sparkles, gradients that wash out legibility,
or extra text. Center the emblem inside the central 64 percent of the square so
launcher masks cannot cut off the mark. Background fully opaque, square and full
bleed to all four edges. Do not draw an outer rounded-square app tile or outer
border; operating systems supply the final mask. No official EverQuest logo.
Deliver the icon artwork alone at 1024x1024 or greater square resolution.
