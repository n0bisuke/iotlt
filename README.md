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
