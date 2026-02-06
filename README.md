# IoTLT connpass scraper

`scripts/scrape_iotlt_connpass.mjs` fetches IoTLT event pages from connpass, validates slide links, and writes rows to a Markdown table.

Run (needs network access):

```sh
node scripts/scrape_iotlt_connpass.mjs --rebuild --start-page auto --end-page 1 --out data/iotlt_events.md
```

Rebuild from scratch (recommended when schema changes):

```sh
node scripts/scrape_iotlt_connpass.mjs --rebuild --start-page auto --end-page 1 --out data/iotlt_events.md
```

## Visualization (都道府県マップ)

`data/iotlt_events.md` を解析して、どの都道府県で開催したかを「日本地図（タイルマップ）」で可視化する静的サイトを `web/` に置いています。

Generate JSON:

```sh
python3 scripts/build_events_json.py --in data/iotlt_events.md --out web/events.json
```

Run locally:

```sh
python3 -m http.server 8000 --directory web
```

Open `http://localhost:8000` to view.
