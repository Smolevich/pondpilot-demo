# PondPilot Vue Demo

This demo showcases using [pondpilot-widget](https://github.com/pondpilot/pondpilot-widget) inside a Vue 3 application. It allows you to upload large CSV or Excel files and query them locally in your browser via DuckDB WASM.

On the page, upload a file and a SQL editor will appear. The data is loaded into a table named `data`. Edit the query and run it to explore your file directly in the browser.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:5173` to try it.

An identicon favicon is embedded via a data URI in `index.html`. Replace it with your own if desired.

## GitHub Pages

The project is deployed using GitHub Actions to the `gh-pages` branch. Any push to `master` builds the Vue app and publishes the `dist` folder.

Vite's `base` option is configured to `/pondpilot-demo/` in `vite.config.js` so that asset paths resolve correctly when the site is hosted at `https://smolevich.github.io/pondpilot-demo/`.

