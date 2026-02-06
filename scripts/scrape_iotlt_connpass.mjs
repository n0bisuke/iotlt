#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const LIST_URL_TEMPLATE = "https://iotlt.connpass.com/event/?page={page}";

const TWEET_DOMAINS = new Set([
  "togetter.com",
  "min.togetter.com",
  "posfie.com",
  "twilog.togetter.com"
]);

const SLIDE_DOMAINS = new Set([
  "speakerdeck.com",
  "www.slideshare.net",
  "slideshare.net",
  "docs.google.com"
]);

const SHORTENER_DOMAINS = new Set([
  "t.co",
  "bit.ly",
  "tinyurl.com",
  "goo.gl",
  "buff.ly",
  "ow.ly"
]);

const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const BARE_URL_RE =
  /(?:(?<=\s)|(?<=\()|(?<=\[)|(?<=\{)|^)((?:www\.)?(?:togetter\.com|min\.togetter\.com|posfie\.com|speakerdeck\.com|slideshare\.net|www\.slideshare\.net|docs\.google\.com)\/[^\s"'<>]+)/g;

function decodeHtmlEntities(s) {
  return (s ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function stripTags(s) {
  return decodeHtmlEntities((s ?? "").replace(/<[^>]*>/g, ""));
}

function parseArgs(argv) {
  const args = {
    startPage: "auto",
    endPage: null,
    limit: 5,
    out: "data/iotlt_events.md",
    slideCache: "data/slide_url_cache.json",
    rebuild: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rebuild") args.rebuild = true;
    else if (a === "--start-page") args.startPage = argv[++i];
    else if (a === "--end-page") args.endPage = Number(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--slide-cache") args.slideCache = argv[++i];
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/scrape_iotlt_connpass.mjs [options]

Options:
  --rebuild                 Rebuild output markdown from scratch
  --start-page <n|auto>     Start page (auto=oldest page)
  --end-page <n>            End page (inclusive), default depends on mode
  --limit <n>               Number of NEW events to append (non-rebuild mode)
  --out <path>              Output markdown path
  --slide-cache <path>      Slide URL validation cache JSON path
`);
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function mdEscapeCell(value) {
  const s = (value ?? "")
    .toString()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, " ");
  return s.replaceAll("|", "&#124;").trim();
}

function formatCellLinks(urls) {
  if (!urls || urls.length === 0) return "";
  return urls.join("<br>");
}

function domainOf(urlString) {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeCandidateUrl(raw) {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^<|>$/g, "");
  s = s.replace(/["']/g, "");
  s = s.replace(/[).,;\]]+$/g, "");
  s = decodeHtmlEntities(s);
  if (!s) return null;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("www.")) return `https://${s}`;
  if (/^(togetter\.com|min\.togetter\.com|posfie\.com|speakerdeck\.com|slideshare\.net|docs\.google\.com)\//.test(s)) {
    return `https://${s}`;
  }
  return null;
}

function isTweetSummaryUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  const p = u.pathname || "";

  if (host === "togetter.com" || host === "min.togetter.com") {
    return p.startsWith("/li/") || p.startsWith("/id/");
  }
  if (host.endsWith(".togetter.com")) return false;
  if (host === "posfie.com" || host.endsWith(".posfie.com")) return true;
  if (host === "twilog.togetter.com") return true;
  return false;
}

function inferMode(venueName, address) {
  const venue = (venueName || "").trim();
  const adr = (address || "").trim();
  const combined = `${venue} ${adr}`;
  const onlineKeywords = ["オンライン", "Zoom", "Teams", "Google Meet", "YouTube", "配信", "ウェビナー"];
  const isOnline = onlineKeywords.some((k) => combined.includes(k));

  if (venue === "未定" && !adr) return "未定";
  if (isOnline && adr && adr !== "オンライン") return "オンライン / 対面";
  if (isOnline || venue === "オンライン" || adr === "オンライン") return "オンライン";
  if (adr) return "対面";
  return "未定";
}

function inferTypeAndVol(title) {
  const normalizedTitle = (title ?? "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  let vol = "";
  const patterns = [
    /vol\.?\s*(\d+)/i,
    /IoTLTvol\.?\s*(\d+)/i,
    /IoTLT\s*vol\.?\s*(\d+)/i,
    /(?:^|[^\w])IoTLT\s*#\s*(\d+)\b/i,
    /(?:^|[^\w])[A-Za-z0-9]+IoTLT\s*#\s*(\d+)\b/i,
    /第\s*(\d+)\s*(?:回|回目)/,
    /#\s*(\d+)\b/
  ];
  for (const re of patterns) {
    const m = normalizedTitle.match(re);
    if (m) {
      vol = `vol.${m[1]}`;
      break;
    }
  }

  const lower = normalizedTitle.toLowerCase();
  if (!normalizedTitle.includes("IoTLT") && !lower.includes("iotlt")) return { eventType: "その他", vol };

  const subTypes = [];
  const reSub = /([A-Za-z0-9一-龥ぁ-んァ-ンー]+)IoTLT/g;
  let mm;
  while ((mm = reSub.exec(normalizedTitle))) {
    const t = `${mm[1]}IoTLT`;
    if (t !== "IoTLT" && !subTypes.includes(t)) subTypes.push(t);
  }
  if (subTypes.length > 0) return { eventType: subTypes.join(" / "), vol };
  return { eventType: "本体", vol };
}

async function fetchText(url, { timeoutMs = 30000, headers = {}, method = "GET" } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      headers: {
        "User-Agent": "iotlt-connpass-scraper/1.0 (+github actions)",
        ...headers
      },
      signal: controller.signal
    });
    const text = await res.text();
    return { status: res.status, url: res.url, text };
  } finally {
    clearTimeout(t);
  }
}

async function fetchHeadFinalUrl(url, { timeoutMs = 12000 } = {}) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    return { status: res.status, url: res.url };
  } catch {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs)
      });
      return { status: res.status, url: res.url };
    } catch {
      return { status: 0, url };
    }
  }
}

function extractTitleFromHtml(html) {
  const m = html.match(/<title>\s*(.*?)\s*<\/title>/is);
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
}

function isNotFoundTitle(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("not found") || t.includes("page not found") || t.includes("404")) return true;
  if ((title || "").includes("ページが見つかりません")) return true;
  return false;
}

function loadJson(pathname) {
  try {
    return JSON.parse(fs.readFileSync(pathname, "utf-8"));
  } catch {
    return {};
  }
}

function saveJsonAtomic(pathname, data) {
  ensureDirForFile(pathname);
  const tmp = `${pathname}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0));
  fs.renameSync(tmp, pathname);
}

async function isValidSlideUrl(url, slideCache) {
  if (Object.prototype.hasOwnProperty.call(slideCache, url)) return Boolean(slideCache[url]);

  try {
    const { status, url: effectiveUrl, text } = await fetchText(url, {
      timeoutMs: 18000,
      headers: { Range: "bytes=0-50000" }
    });
    if (status !== 200) {
      slideCache[url] = false;
      return false;
    }
    const title = extractTitleFromHtml(text);
    if (isNotFoundTitle(title)) {
      slideCache[url] = false;
      return false;
    }
    const snippet = text.slice(0, 2000).replace(/\s+/g, " ").toLowerCase();
    if (snippet.includes("404") && snippet.includes("not found")) {
      slideCache[url] = false;
      return false;
    }
    // If it redirected, store the original as valid; we keep original URL in output.
    void effectiveUrl;
    slideCache[url] = true;
    return true;
  } catch {
    slideCache[url] = false;
    return false;
  }
}

function extractLinksFromHtml(html) {
  const urls = [];

  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    const hrefMatch = tag.match(/\bhref="([^"]+)"/i);
    if (!hrefMatch) continue;
    const u = normalizeCandidateUrl(hrefMatch[1]);
    if (u) urls.push(u);
  }

  for (const m of html.matchAll(URL_RE)) {
    const u = normalizeCandidateUrl(m[0]);
    if (u) urls.push(u);
  }
  for (const m of html.matchAll(BARE_URL_RE)) {
    const u = normalizeCandidateUrl(m[1]);
    if (u) urls.push(u);
  }

  const out = [];
  const seen = new Set();
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function extractParticipants(html) {
  const patterns = [
    /参加者（\s*(\d+)\s*人）/,
    /参加者（\s*(\d+)\s*名）/,
    /参加者\s*[（(]\s*(\d+)\s*(?:人|名)\s*[）)]/,
    /参加者一覧（\s*(\d+)\s*(?:人|名)）/,
    /参加者一覧\s*[（(]\s*(\d+)\s*(?:人|名)\s*[）)]/
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return Number(m[1]);
  }
  if (html.includes("当サイト以外で申し込み") || html.includes("申し込み不要")) return 0;
  throw new Error("could not extract participants");
}

function extractDateWeekdayTime(html) {
  const m = html.match(/\d{4}\/\d{2}\/\d{2}\(([^)]+)\)\s*(\d{1,2}:\d{2})\s*(?:～|〜|-)\s*(\d{1,2}:\d{2})/);
  if (m) return { weekday: m[1].trim(), timeRange: `${m[2]}~${m[3]}` };
  const m2 = html.match(/\d{4}\/\d{2}\/\d{2}\(([^)]+)\)\s*(\d{1,2}:\d{2})/);
  if (m2) return { weekday: m2[1].trim(), timeRange: `${m2[2]}~` };
  return { weekday: "", timeRange: "" };
}

function extractDateOnly(html) {
  const m = html.match(/(\d{4})\/(\d{2})\/(\d{2})\([^)]*\)/) || html.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) throw new Error("could not extract date");
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function extractVenueFromHtml(html) {
  const placeBlockMatch = html.match(/<p\s+class="place_name[^"]*">\s*([\s\S]*?)\s*<\/p>/i);
  const adrBlockMatch = html.match(/<p\s+class="adr">\s*([\s\S]*?)\s*<\/p>/i);
  const venueName = placeBlockMatch ? stripTags(placeBlockMatch[1]).replace(/\s+/g, " ").trim() : "";
  const address = adrBlockMatch ? stripTags(adrBlockMatch[1]).replace(/\s+/g, " ").trim() : "";
  return { venueName, address };
}

async function eventRowFromUrl(url, slideCache) {
  const { status, text } = await fetchText(url, { timeoutMs: 30000 });
  if (status !== 200) throw new Error(`unexpected status ${status} for ${url}`);

  const titleMatch = text.match(/<div\s+class="current_event_title">\s*([\s\S]*?)\s*<\/div>/i);
  const title = (titleMatch ? stripTags(titleMatch[1]) : "").replace(/\s+/g, " ").trim() || extractTitleFromHtml(text);
  const { eventType, vol } = inferTypeAndVol(title);
  const date = extractDateOnly(text);
  const { weekday, timeRange } = extractDateWeekdayTime(text);

  let participants;
  try {
    participants = extractParticipants(text);
  } catch {
    const p = await fetchText(`${url.replace(/\/$/, "")}/participation/`, { timeoutMs: 30000 });
    if (p.status === 200) participants = extractParticipants(p.text);
    else participants = 0;
  }

  const { venueName, address } = extractVenueFromHtml(text);
  const mode = inferMode(venueName, address);

  const links = extractLinksFromHtml(text);
  const tweetUrls = [];
  const slideCandidates = [];

  for (let link of links) {
    let d = domainOf(link);
    if (SHORTENER_DOMAINS.has(d)) {
      const expanded = await fetchHeadFinalUrl(link);
      link = expanded.url;
      d = domainOf(link);
    }

    if (isTweetSummaryUrl(link)) {
      tweetUrls.push(link);
      continue;
    }

    if (SLIDE_DOMAINS.has(d) || [...SLIDE_DOMAINS].some((sd) => d.endsWith(`.${sd}`))) {
      if (d === "docs.google.com" && !link.includes("/presentation/")) continue;
      slideCandidates.push(link);
    }
  }

  const slideUrls = [];
  for (const link of slideCandidates) {
    if (await isValidSlideUrl(link, slideCache)) slideUrls.push(link);
  }

  return {
    vol,
    eventType,
    title,
    mode,
    venueName,
    address,
    connpassUrl: url,
    tweetUrls,
    slideUrls,
    participants,
    date,
    weekdayJa: weekday,
    timeRange
  };
}

async function eventUrlsFromListPage(page) {
  const listUrl = LIST_URL_TEMPLATE.replace("{page}", String(page));
  const { status, text } = await fetchText(listUrl, { timeoutMs: 30000 });
  if (status !== 200) throw new Error(`unexpected status ${status} for list page ${listUrl}`);

  const urls = [];
  for (const m of text.matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    const classMatch = tag.match(/\bclass="([^"]+)"/i);
    const hrefMatch = tag.match(/\bhref="([^"]+)"/i);
    if (!hrefMatch) continue;
    const cls = classMatch ? classMatch[1] : "";
    if (!/\burl\b/.test(cls) || !/\bsummary\b/.test(cls)) continue;
    urls.push(decodeHtmlEntities(hrefMatch[1]));
  }

  const out = [];
  const seen = new Set();
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function detectOldestPageNumber() {
  const { status, text } = await fetchText(LIST_URL_TEMPLATE.replace("{page}", "1"), { timeoutMs: 30000 });
  if (status !== 200) throw new Error("unexpected status for list page=1");

  const m = text.match(/イベント（\s*(\d+)\s*件）/);
  if (!m) throw new Error("could not detect total event count from list page=1");
  const total = Number(m[1]);

  const perPage = (text.match(/group_event_list vevent/g) || []).length;
  if (perPage <= 0) throw new Error("could not detect per-page event count from list page=1");

  return Math.ceil(total / perPage);
}

function ensureTableHeader(outPath) {
  if (fs.existsSync(outPath) && fs.readFileSync(outPath, "utf-8").trim()) return;
  ensureDirForFile(outPath);
  fs.writeFileSync(
    outPath,
    [
      "| id | vol | タイプ | タイトル | 実施形態 | 会場名 | 住所 | connpass URL | ツイートまとめ URL | LTスライド | 参加者数 | 日付 | 曜日 | 時間 |",
      "|---:|:---:|:---|:---|:---:|:---|:---|:---|:---|:---|---:|:---:|:---:|:---:|"
    ].join("\n") + "\n"
  );
}

function writeAllRows(outPath, rows) {
  ensureDirForFile(outPath);
  const lines = [];
  lines.push(
    "| id | vol | タイプ | タイトル | 実施形態 | 会場名 | 住所 | connpass URL | ツイートまとめ URL | LTスライド | 参加者数 | 日付 | 曜日 | 時間 |"
  );
  lines.push("|---:|:---:|:---|:---|:---:|:---|:---|:---|:---|:---|---:|:---:|:---:|:---:|");

  for (let i = 0; i < rows.length; i++) {
    const rowId = i + 1;
    const r = rows[i];
    lines.push(
      "| " +
        [
          rowId,
          mdEscapeCell(r.vol),
          mdEscapeCell(r.eventType),
          mdEscapeCell(r.title),
          mdEscapeCell(r.mode),
          mdEscapeCell(r.venueName),
          mdEscapeCell(r.address),
          mdEscapeCell(r.connpassUrl),
          mdEscapeCell(formatCellLinks(r.tweetUrls)),
          mdEscapeCell(formatCellLinks(r.slideUrls)),
          r.participants,
          mdEscapeCell(r.date),
          mdEscapeCell(r.weekdayJa),
          mdEscapeCell(r.timeRange)
        ].join(" | ") +
        " |"
    );
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slideCache = loadJson(args.slideCache);

  const startPage = args.startPage === "auto" ? await detectOldestPageNumber() : Number(args.startPage);
  const endPage = args.endPage ?? (args.rebuild ? 1 : startPage);
  if (endPage > startPage) throw new Error("--end-page must be <= --start-page");

  if (!args.rebuild) {
    throw new Error("Non-rebuild mode is not supported in the Node rewrite. Use --rebuild.");
  }

  const allRows = [];
  const seenUrls = new Set();

  for (let pageNum = startPage; pageNum >= endPage; pageNum--) {
    const urls = await eventUrlsFromListPage(pageNum);
    for (const u of urls) {
      if (seenUrls.has(u)) continue;
      seenUrls.add(u);
      const row = await eventRowFromUrl(u, slideCache);
      allRows.push(row);
    }
    saveJsonAtomic(args.slideCache, slideCache);
  }

  allRows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.timeRange !== b.timeRange) return a.timeRange.localeCompare(b.timeRange);
    return a.connpassUrl.localeCompare(b.connpassUrl);
  });

  ensureDirForFile(args.out);
  writeAllRows(args.out, allRows);
  saveJsonAtomic(args.slideCache, slideCache);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
