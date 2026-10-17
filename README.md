# Nsem Cards

A proverb and Adinkra card maker for Ghanaians. Pick an Akan proverb (or type your own words), choose an Adinkra symbol and a theme, then download or share a 1080×1920 card, the size of a WhatsApp status. You can also make a 6-second animated video.

It's plain HTML, CSS and JavaScript: no framework, no build step, no server code. The app itself is about 70 KB (about 25 KB gzipped), plus 57 KB of fonts.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page |
| `styles.css` | Layout and look |
| `app.js` | Card drawing, themes, animation, video recording, download/share |
| `symbols.js` | The 8 Adinkra symbol paths (24×24 SVG paths) |
| `proverbs.json` | The proverb list. Edit this to add proverbs |
| `fonts/` | Self-hosted, subset fonts that include Twi letters (ɛ ɔ Ɛ Ɔ) |
| `_headers` | Cache rules for Cloudflare Pages (ignored elsewhere) |
| `.nojekyll` | Stops GitHub Pages from running Jekyll |

## Run it locally

The page loads `proverbs.json` with `fetch`, which browsers block for `file://` pages. Serve the folder over HTTP instead:

```sh
cd nsem-cards
python3 -m http.server 8080
# or: npx http-server -p 8080
```

Then open http://localhost:8080. To test on your phone, open `http://<your-computer's-IP>:8080` while on the same Wi-Fi. (Web Share and video recording need HTTPS on a real domain; localhost also counts as secure.)

## Deploy on Cloudflare Pages

**From GitHub (auto-deploys on every push):**

1. Push this folder to a GitHub repository.
2. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repository.
3. Build settings: Framework preset **None**, Build command **(leave empty)**, Build output directory **`/`**.
4. Click **Save and Deploy**. Your site will be at `https://<project>.pages.dev`.

**Without Git (drag and drop):** go to **Workers & Pages → Create → Pages → Upload assets**, name the project, and drop the whole folder in.

**From the command line:**

```sh
npx wrangler pages deploy . --project-name nsem-cards
```

The `_headers` file tells Cloudflare to cache fonts for a year and `proverbs.json` for an hour.

## Deploy on GitHub Pages

1. Push this folder to a GitHub repository (files at the root, `index.html` at the top level).
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set Source to **Deploy from a branch**, choose your branch (e.g. `main`) and folder **`/ (root)`**, then **Save**.
4. After a minute the site is live at `https://<user>.github.io/<repo>/`.

All paths in the app are relative, so it works from a sub-folder like `/<repo>/`.

## Add or edit proverbs

Open `proverbs.json`. Each proverb looks like this:

```json
{
  "id": 31,
  "twi": "Ɔbaatan na ɔnim deɛ ne ba bɛdi.",
  "en": "The mother knows what her child will eat.",
  "meaning": "Those closest to us know our needs best.",
  "review": "needs review"
}
```

- `twi`: the proverb in Twi. It's the big text on the card.
- `en`: the English translation. It's the smaller line under the Twi.
- `meaning`: a short explanation, shown under the picker (not on the card).
- `review`: keep `"needs review"` until a Twi speaker has checked it, then change it to `"ok"`.
- `id`: any unique number.

Add your new object inside the `"proverbs": [ ... ]` list, with a comma between objects. Make sure the file is still valid JSON (paste it into https://jsonlint.com if unsure). Long proverbs are fine: the text shrinks automatically to fit.

Type Twi letters directly (ɛ, ɔ, Ɛ, Ɔ). The fonts also include ŋ, ɖ, ƒ, ɣ, ʋ, so Ewe and Ga text works too.

**Review status:** all 30 included proverbs are marked `"needs review"`. JSON can't hold comments, so the `review` field and the `_comment` at the top of the file stand in for them. Please have a Twi speaker check spelling and translations before a public launch.

## Features

- **Message:** pick from the proverb list (or tap ⤮ for a random one), or write your own words with an optional small line.
- **8 Adinkra symbols:** Gye Nyame, Sankofa, Dwennimmen, Adinkrahene, Funtunfunefu, Nyame Dua, Akoma, Duafe.
- **7 themes:** Kente, Dark gold, Sunset, Minimal white, Green black & gold, Red & gold, Ink stamp. Ink stamp roughens the symbol's edges, varies the ink density, adds a cloth texture and comb lines, and plays a short stamp animation before downloading.
- **Picture:** PNG download, and **Share** through the phone's share sheet (Web Share API with files). Where sharing isn't supported, the card downloads instead.
- **Animated video (optional):** kente-style woven threads draw in, then the symbol appears and the proverb is written in line by line in a handwritten font. The 6-second clip is recorded with MediaRecorder as MP4 where the browser supports it (Chrome on Android, Safari), otherwise WebM. The app warns that video uses more battery and data.
- **Watermark:** a small "Made with Nsem Cards" sits at the bottom of every card.
- **Ad slot:** `<aside id="ad-slot">` under the preview is a 320×100 placeholder. Put your ad code inside it.
- The app remembers your last symbol, theme and format on that device.

## Notes

- **WhatsApp and WebM:** WhatsApp does not accept WebM videos. Desktop Chrome and Firefox record WebM, so share the PNG from those, or record on a phone.
- **Keep the screen on while recording:** browsers pause animation in background tabs, which would spoil the video.
- **Adding a symbol:** add an entry to `symbols.js` with an `id`, `name`, `meaning` and a `d` path drawn on a 24×24 grid. It appears in the picker automatically.

## Credits

Symbol paths: ghicons (MIT), based on Adinkra Icons (Apache 2.0). Fonts: Noto Serif, Playpen Sans and Unbounded (SIL OFL 1.1). Full details are in [CREDITS.md](CREDITS.md).
