# IoTLT connpass scraper

`scripts/scrape_iotlt_connpass.py` fetches IoTLT event pages from connpass, validates slide links, and appends rows to a Markdown table.

Run (needs network access):

```sh
python3 scripts/scrape_iotlt_connpass.py --start-page 43 --limit 5 --out data/iotlt_events.md
```

Continue appending (script skips already-written connpass URLs):

```sh
# append next 20 events, starting from the oldest pages
python3 scripts/scrape_iotlt_connpass.py --start-page 43 --end-page 1 --limit 20 --out data/iotlt_events.md
```

Rebuild from scratch (recommended when schema changes):

```sh
python3 scripts/scrape_iotlt_connpass.py --rebuild --start-page 43 --end-page 1 --out data/iotlt_events.md
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
