// discovery.mjs — Automated job discovery engine for Sudakshina Deb
// Focuses heavily on Indian life sciences & biopharma openings (LinkedIn India, BioTecNika, Adzuna India)
// and restricts international searches exclusively to PhD / Doctoral opportunities (jobRxiv, LinkedIn PhD, Adzuna PhD).
//
// Designed to run as a scheduled GitHub Action (no Cloudflare Workers subrequest cap).

import { createHash } from "node:crypto";

// =============================================================================
// CONFIG
// =============================================================================
const CONFIG = {
  // Max jobs analyzed per run. 40 jobs/run × 3 runs/day = ~120/day
  MAX_ANALYZE_PER_RUN: 40,

  // Job dedup keys persist in KV for 60 days
  SEEN_TTL_SECONDS: 60 * 60 * 24 * 60,

  // ---- 1. INDIA BIOPHARMA / BIOTECH SOURCES ----
  // BioTecNika: India's #1 life sciences career portal (daily biopharma, CRO & academic openings)
  BIOTECNIKA_ENABLED: true,
  BIOTECNIKA_FEEDS: [
    "https://www.biotecnika.org/category/biotech-jobs/feed/",
    "https://www.biotecnika.org/feed/",
  ],

  // ---- 2. LINKEDIN PUBLIC GUEST SEARCH (Zero credentials required) ----
  LINKEDIN_ENABLED: true,

  // India Industry Jobs: Target Indian biopharma hubs
  LINKEDIN_INDIA_LOCATIONS: [
    "Bengaluru",
    "Hyderabad",
    "Pune",
    "Mumbai",
    "Ahmedabad",
    "India",
  ],
  LINKEDIN_INDIA_QUERIES: [
    '"protein purification" OR "chromatography"',
    '"downstream processing" OR "bioprocess"',
    '"monoclonal antibody" OR "bispecific" OR "mab"',
    '"bioinformatics" OR "computational biology" OR "NGS"',
    '"scientist" AND ("biologics" OR "protein")',
  ],

  // Abroad: STRICTLY PhD / Doctoral Positions (including Asian research hubs: Japan, South Korea, China, Singapore)
  LINKEDIN_PHD_LOCATIONS: [
    "Japan",
    "South Korea",
    "China",
    "Singapore",
    "Europe",
    "Germany",
    "United Kingdom",
    "United States",
    "Switzerland",
    "Australia",
  ],
  LINKEDIN_PHD_QUERIES: [
    '"PhD student" OR "PhD candidate" OR "Doctoral researcher" OR "PhD position"',
  ],
  LINKEDIN_MAX_PER_QUERY: 20,

  // ---- 3. INTERNATIONAL PHD RSS (jobRxiv) ----
  // WP Job Manager RSS from jobRxiv — structured doctoral / academic research positions
  JOBRXIV_ENABLED: true,
  JOBRXIV_KEYWORDS: ["phd", "doctoral", "protein", "bioinformatics"],

  // ---- 4. ADZUNA AGGREGATOR API ----
  ADZUNA_ENABLED: true,

  // India Queries: Fires on EVERY run to harvest from Naukri, Indeed, Monster/Foundit, TimesJobs
  ADZUNA_INDIA_QUERIES: [
    "protein purification",
    "antibody scientist",
    "downstream processing biotech",
    "quality control biologics",
    "biopharma scientist",
    "biotech research associate",
    "bioinformatics scientist",
    "computational biology",
    "AKTA chromatography",
    "monoclonal antibody",
  ],

  // International Countries: Rotated across runs
  ADZUNA_INTERNATIONAL_COUNTRIES: ["gb", "de", "us", "ca", "au", "ch", "nl", "fr", "sg"],

  // International Queries: STRICTLY PhD / Doctoral Positions (No abroad industry jobs)
  ADZUNA_INTERNATIONAL_PHD_QUERIES: [
    "PhD protein engineering",
    "PhD bioinformatics",
    "PhD computational biology",
    "PhD structural biology",
    "doctoral researcher biology",
    "PhD genomics",
  ],

  ADZUNA_RESULTS_PER_CALL: 25,
  ADZUNA_MAX_DAYS_OLD: 30,

  // ---- 5. ATS FEEDS (Direct biotech career pages) ----
  ATS: {
    greenhouse: [
      "twistbioscience", "manifoldbio", "genscript", "remixtherapeutics",
      "shennonbiotechnologies", "absci", "generatebiomedicines",
      "xairatherapeutics", "voyagertherapeutics",
      "recursionpharmaceuticals", "virbio", "sanabiotechnology",
      "schrodinger", "arcusbio", "insitro",
    ],
    lever: ["benchling", "modernatx"],
    ashby: ["octant"],
  },

  // ---- 6. OPTIONAL AGGREGATORS (Activate only if secrets are set) ----
  JOOBLE_ENABLED: true,
  JOOBLE_LOCATIONS: ["India", "Bengaluru", "Hyderabad"],
  JOOBLE_KEYWORDS: "protein purification, downstream processing, akta chromatography, bioinformatics scientist, bioprocess",

  JSEARCH_ENABLED: true,
  JSEARCH_INDIA_QUERIES: [
    "Protein Purification Scientist in India",
    "Downstream Scientist in Bengaluru",
    "Bioinformatics Scientist in India",
  ],
  JSEARCH_PHD_QUERIES: [
    "PhD Structural Biology in Europe",
    "PhD Bioinformatics in Germany",
    "PhD Protein Engineering in UK",
  ],
};

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 8000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// =============================================================================
// SECRETS
// =============================================================================
const ENV = {
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
  CF_API_TOKEN: process.env.CF_API_TOKEN,
  CF_KV_NAMESPACE_ID: process.env.CF_KV_NAMESPACE_ID,
  CAREER_ANALYZER_URL: process.env.CAREER_ANALYZER_URL,
  ADZUNA_APP_ID: process.env.ADZUNA_APP_ID,
  ADZUNA_APP_KEY: process.env.ADZUNA_APP_KEY,
  JOOBLE_API_KEY: process.env.JOOBLE_API_KEY,
  RAPIDAPI_KEY: process.env.RAPIDAPI_KEY,
};

function requireEnv(keys) {
  const missing = keys.filter(k => !ENV[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    console.error(`Set them as repo secrets in GitHub: Settings → Secrets and variables → Actions.`);
    process.exit(1);
  }
}

// =============================================================================
// KEYWORD PRE-FILTER (Life Sciences / Protein Science / PhD)
// =============================================================================
const STRONG_POSITIVE = [
  "protein purification", "monoclonal antibod", "mab", "bispecific", "antibody",
  "akta", "fplc", "chromatograph", "protein a", "affinity", "ion exchange",
  "downstream process", "tff", "ultrafiltration", "diafiltration", "sec-hplc",
  "bioprocess", "biologics", "endotoxin", "purification",
  "bioinformatic", "ngs", "qiime", "16s", "microbiome", "computational biolog",
  "genomic", "transcriptomic", "multi-omic", "rna-seq", "sequencing",
  "alphafold", "structural biolog", "protein engineering", "neurogenetic",
];
const PHD_POSITIVE = ["phd", "ph.d", "doctoral", "research fellow", "predoctoral"];
const HARD_NEGATIVE = [
  "sales", "business development", "account manager", "medical coding", "billing",
  "call center", "call centre", "customer support", "customer relationship",
  "recruiter", "recruitment", "data entry", "telecaller", "bpo", "insurance",
  "real estate", "marketing manager", "marketing campaigns", "media specialist",
  "global marketing", "product manager", "product management", "commodity business",
  "warehouse", "logistics", "procurement", "supply chain", "treasury", "customs",
  "trade compliance", "import & export", "import and export", "facility project",
  "construction project", "general affairs", "ehs manager", "lab supervisor",
  "lab technician", "order management", "material transfer",
  "legal counsel", "legal intern", "corporate legal", "sap engineer", "sap ",
  "it support", "it engineer", "biostatistics", "program team lead",
  "surfactant", "fmcg", "cattle", "veterinary", "nursing",
  "postdoc", "post-doc", "post doctoral", "postdoctoral",
];

function prefilterPass(text, minScore = 2) {
  const t = (text || "").toLowerCase();
  if (t.length < 30) return false;
  let score = 0;
  for (const kw of STRONG_POSITIVE) if (t.includes(kw)) score += 2;
  for (const kw of PHD_POSITIVE) if (t.includes(kw)) score += 1;
  for (const kw of HARD_NEGATIVE) if (t.includes(kw)) score -= 3;
  return score >= minScore;
}

function thinTextWorthAnalyzing(title) {
  const t = (title || "").toLowerCase().trim();
  if (t.length < 8) return false;
  const JUNK = [
    "read more", "apply now", "apply here", "view all", "see all", "login",
    "sign in", "register", "subscribe", "newsletter", "cookie", "privacy", "terms",
    "contact us", "about us", "home", "next", "previous", "load more", "search jobs",
    "search for jobs", "saved jobs", "jobs expiring", "expiring soon", "young investigators",
    "science communication", "browse", "filter", "sort by", "all jobs", "my account",
    "create account", "post a job", "advertise", "help", "faq", "sitemap", "back to"
  ];
  for (const j of JUNK) if (t === j || t.startsWith(j) || t.includes(j)) return false;
  for (const kw of HARD_NEGATIVE) if (t.includes(kw)) return false;
  const TOO_SENIOR = [
    "professor", "faculty", "dean", "lecturer", "chair ",
    "head of department", "principal investigator", "group leader", "tenure"
  ];
  for (const s of TOO_SENIOR) if (t.includes(s)) return false;
  const DOMAIN = [
    "protein", "antibody", "mab", "purification", "chromatograph",
    "downstream", "bioprocess", "biologic", "bioinformatic", "computational biolog",
    "genomic", "genetic", "microbiome", "ngs", "sequencing", "molecular", "biochem",
    "cell biolog", "cell culture", "immunolog", "structural biolog", "biotech",
    "biology", "life science", "omics", "proteomic", "phd", "doctoral"
  ];
  if (!DOMAIN.some(d => t.includes(d))) return false;
  return true;
}

function stripHtml(s) {
  return (s || "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&#124;/g, "|").replace(/&#0?38;/g, "&").replace(/&#8211;/g, "–").replace(/&#8212;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================================================
// CLOUDFLARE KV via REST API
// =============================================================================
const KV_BASE = () => `https://api.cloudflare.com/client/v4/accounts/${ENV.CF_ACCOUNT_ID}/storage/kv/namespaces/${ENV.CF_KV_NAMESPACE_ID}`;
const KV_HEADERS = () => ({ "Authorization": `Bearer ${ENV.CF_API_TOKEN}` });

async function kvGet(key) {
  try {
    const res = await fetch(`${KV_BASE()}/values/${encodeURIComponent(key)}`, {
      headers: KV_HEADERS(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`KV get ${key} -> ${res.status}`);
    return await res.text();
  } catch (e) {
    if (e.name === "TimeoutError") return null;
    throw e;
  }
}

async function kvPut(key, value, ttlSeconds) {
  const url = `${KV_BASE()}/values/${encodeURIComponent(key)}` + (ttlSeconds ? `?expiration_ttl=${ttlSeconds}` : "");
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...KV_HEADERS(), "Content-Type": "text/plain" },
    body: typeof value === "string" ? value : JSON.stringify(value),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`KV put ${key} -> ${res.status}`);
}

// =============================================================================
// DEDUP KEYS
// =============================================================================
function sha1Hex(s) { return createHash("sha1").update(s).digest("hex"); }

function seenKey(url) {
  const base = (url || "").split("?")[0];
  return "seen:" + sha1Hex(base).slice(0, 24);
}

function normalizeForFingerprint(s) {
  return (s || "").toLowerCase()
    .replace(/\bsr\.?\b/g, "senior").replace(/\bjr\.?\b/g, "junior")
    .replace(/\bassoc\.?\b/g, "associate").replace(/\bmgr\.?\b/g, "manager")
    .replace(/\bengg?\.?\b/g, "engineer")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function fingerprintKey(job) {
  const company = normalizeForFingerprint(job.company).split(" ").slice(0, 2).join(" ");
  const title = normalizeForFingerprint(job.title);
  return "fp:" + sha1Hex(`${company}|${title}`).slice(0, 24);
}

// =============================================================================
// DIRECT APPLY LINK RESOLUTION (Aggregator -> Real Employer Link)
// =============================================================================
function sameDomain(u1, u2) {
  try {
    const d1 = new URL(u1).hostname.replace(/^www\./, "");
    const d2 = new URL(u2).hostname.replace(/^www\./, "");
    return d1 === d2;
  } catch {
    return false;
  }
}

function resolveRelative(maybeRelative, base) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

async function resolveDirectApplyUrl(pageUrl, maxHops = 5) {
  if (!pageUrl) return null;
  const isAggregator = (u) => /adzuna\.|jooble\.org/i.test(u);
  if (!isAggregator(pageUrl)) return pageUrl;

  let current = pageUrl;
  for (let hop = 0; hop < maxHops; hop++) {
    let res;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return !isAggregator(current) ? current : null;
    }

    const finalUrl = res.url || current;
    if (finalUrl !== current && !sameDomain(finalUrl, pageUrl) && !isAggregator(finalUrl)) {
      return finalUrl;
    }

    let html = "";
    try {
      html = await res.text();
    } catch {
      return !isAggregator(finalUrl) ? finalUrl : null;
    }

    // 1. Meta refresh
    const metaRefresh = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^;]+;\s*url=([^"'>\s]+)/i)
      || html.match(/<meta[^>]+content=["'][^;]+;\s*url=([^"'>\s]+)["'][^>]+http-equiv=["']?refresh["']?/i);
    if (metaRefresh) {
      const u = resolveRelative(metaRefresh[1], current);
      if (u && !sameDomain(u, pageUrl) && !isAggregator(u)) return u;
      if (u && u !== current) { current = u; continue; }
    }

    // 2. JS redirect
    const jsRedir = html.match(/(?:window\.)?location(?:\.href|\.replace)\s*=\s*["']([^"']+)["']/i);
    if (jsRedir) {
      const u = resolveRelative(jsRedir[1], current);
      if (u && !sameDomain(u, pageUrl) && !isAggregator(u)) return u;
      if (u && u !== current) { current = u; continue; }
    }

    // 3. JSON-LD schema JobPosting
    const lds = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of lds) {
      try {
        const json = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
        const parsed = JSON.parse(json);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const cand = item && (item.url || item.sameAs || item.potentialAction?.target?.url);
          if (typeof cand === "string" && !sameDomain(cand, pageUrl) && !isAggregator(cand)) {
            return cand;
          }
        }
      } catch {}
    }

    if (!isAggregator(finalUrl)) return finalUrl;
    return null;
  }

  return !isAggregator(current) ? current : null;
}

// =============================================================================
// RSS PARSER HELPER (No external XML dependency)
// =============================================================================
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  const tag = (block, name) => {
    const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
    const mm = block.match(re);
    if (!mm) return "";
    let v = mm[1].trim();
    return v.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
  };
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    items.push({
      title: stripHtml(tag(block, "title")),
      link: tag(block, "link"),
      description: stripHtml(tag(block, "description") || tag(block, "content:encoded")),
      pubDate: tag(block, "pubDate"),
      location: stripHtml(tag(block, "job_listing:location") || tag(block, "location")),
    });
  }
  return items;
}

// =============================================================================
// SOURCE ADAPTERS
// =============================================================================

// ---- 1. BioTecNika (India Life Sciences & Biotech Portal) ----
async function fetchBioTecNika(feedUrl, report) {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { report.push(`biotecnika -> HTTP ${res.status}`); return []; }
    const xml = await res.text();
    const items = parseRssItems(xml);
    const jobs = items
      .filter(it => it.title && it.link)
      .map(it => ({
        title: it.title,
        company: "biotecnika:India",
        location: "India",
        url: it.link,
        description: it.description || it.title,
        postedDate: it.pubDate ? new Date(it.pubDate).toISOString() : "",
      }));
    report.push(`biotecnika -> ${jobs.length} postings`);
    return jobs;
  } catch (e) {
    report.push(`biotecnika -> ERR ${e.message}`);
    return [];
  }
}

// ---- 2. jobRxiv (International PhD / Academic Positions) ----
async function fetchJobRxiv(keyword, report) {
  const url = `https://jobrxiv.org/?feed=job_feed&search_keywords=${encodeURIComponent(keyword)}&posts_per_page=25`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { report.push(`jobrxiv:${keyword} -> HTTP ${res.status}`); return []; }
    const xml = await res.text();
    const items = parseRssItems(xml);
    const jobs = items
      .filter(it => it.title && it.link)
      .map(it => ({
        title: it.title,
        company: `jobrxiv:${keyword}`,
        location: it.location || "International",
        url: it.link,
        description: it.description || it.title,
        postedDate: it.pubDate ? new Date(it.pubDate).toISOString() : "",
      }));
    report.push(`jobrxiv:${keyword} -> ${jobs.length} (phd/academic)`);
    return jobs;
  } catch (e) {
    report.push(`jobrxiv:${keyword} -> ERR ${e.message}`);
    return [];
  }
}

// ---- 3. LinkedIn Public Guest API ----
async function searchLinkedIn(keywordsQuery, location) {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keywordsQuery)}&location=${encodeURIComponent(location)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const jobs = [];
  const linkMatches = [...html.matchAll(/<a[^>]*class=["'][^"']*base-card__full-link[^"']*["'][^>]*href=["']([^"']+)["']/gi)];
  const titleMatches = [...html.matchAll(/<h3[^>]*class=["'][^"']*base-search-card__title[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/h3>/gi)];
  const compMatches = [...html.matchAll(/<h4[^>]*class=["'][^"']*base-search-card__subtitle[^"']*["'][^>]*>[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/gi)];
  const locMatches = [...html.matchAll(/<span[^>]*class=["'][^"']*job-search-card__location[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/span>/gi)];

  for (let i = 0; i < linkMatches.length; i++) {
    const rawLink = linkMatches[i][1];
    const idMatch = rawLink.match(/-(\d+)(?:\?|$)/);
    if (!idMatch) continue;

    const jobId = idMatch[1];
    const cleanLink = `https://www.linkedin.com/jobs/view/${jobId}`;
    const title = titleMatches[i] ? stripHtml(titleMatches[i][1]) : "";
    const company = compMatches[i] ? stripHtml(compMatches[i][1]) : "";
    const loc = locMatches[i] ? stripHtml(locMatches[i][1]) : location;

    jobs.push({ id: jobId, title, company, location: loc, url: cleanLink });
  }

  return jobs;
}

async function fetchLinkedInDetail(jobId) {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const descMatch = html.match(/<div[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const snippet = descMatch ? stripHtml(descMatch[1]).slice(0, 8000) : "";

  const dateMatch = html.match(/<span[^>]*class=["'][^"']*posted-time-ago__text[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i);
  const postedDate = dateMatch ? stripHtml(dateMatch[1]) : "";

  return { snippet, postedDate };
}

// ---- 4. Adzuna Aggregator API ----
async function fetchAdzuna(country, query, report) {
  if (!ENV.ADZUNA_APP_ID || !ENV.ADZUNA_APP_KEY) return [];
  const params = new URLSearchParams({
    app_id: ENV.ADZUNA_APP_ID,
    app_key: ENV.ADZUNA_APP_KEY,
    what: query,
    results_per_page: String(CONFIG.ADZUNA_RESULTS_PER_CALL),
    max_days_old: String(CONFIG.ADZUNA_MAX_DAYS_OLD),
    "content-type": "application/json",
  });
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) { report.push(`adzuna:${country}:"${query}" -> HTTP ${res.status}`); return []; }
    const data = await res.json();
    const jobs = (data.results || []).map(j => ({
      title: j.title || "",
      company: `adzuna:${country}`,
      location: j.location?.display_name || (j.location?.area || []).slice(-2).join(", ") || "",
      url: j.redirect_url || "",
      description: (j.company?.display_name ? `Company: ${j.company.display_name}\n\n` : "") + stripHtml(j.description || ""),
      postedDate: j.created || "",
      _realCompany: j.company?.display_name || "",
    }));
    report.push(`adzuna:${country}:"${query}" -> ${jobs.length}`);
    return jobs;
  } catch (e) { report.push(`adzuna:${country}:"${query}" -> ERR ${e.message}`); return []; }
}

async function pickInternationalAdzunaSlice() {
  const countries = CONFIG.ADZUNA_INTERNATIONAL_COUNTRIES;
  const queries = CONFIG.ADZUNA_INTERNATIONAL_PHD_QUERIES;
  const total = countries.length * queries.length;
  let cursor = 0;
  try {
    const stored = await kvGet("discovery:adzuna_phd_cursor");
    if (stored) cursor = parseInt(stored, 10) || 0;
  } catch {}
  const slice = [];
  const callsPerRun = 4;
  for (let i = 0; i < callsPerRun; i++) {
    const idx = (cursor + i) % total;
    const c = countries[idx % countries.length];
    const q = queries[Math.floor(idx / countries.length) % queries.length];
    slice.push({ country: c, query: q });
  }
  const newCursor = (cursor + callsPerRun) % total;
  try { await kvPut("discovery:adzuna_phd_cursor", String(newCursor)); } catch {}
  return slice;
}

// ---- 5. ATS Company Feeds (Greenhouse, Lever, Ashby) ----
async function fetchGreenhouse(token, report) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { report.push(`greenhouse:${token} -> HTTP ${res.status}`); return []; }
    const data = await res.json();
    const jobs = (data.jobs || []).map(j => ({
      title: j.title || "",
      company: token,
      location: j.location?.name || "",
      url: j.absolute_url || "",
      description: stripHtml(j.content || ""),
      postedDate: j.first_published || j.updated_at || "",
    }));
    report.push(`greenhouse:${token} -> ${jobs.length}`);
    return jobs;
  } catch (e) { report.push(`greenhouse:${token} -> ERR ${e.message}`); return []; }
}

async function fetchLever(token, report) {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { report.push(`lever:${token} -> HTTP ${res.status}`); return []; }
    const data = await res.json();
    const jobs = (data || []).map(j => ({
      title: j.text || "",
      company: token,
      location: j.categories?.location || "",
      url: j.hostedUrl || "",
      description: stripHtml(j.descriptionPlain || j.description || ""),
      postedDate: j.createdAt ? new Date(j.createdAt).toISOString() : "",
    }));
    report.push(`lever:${token} -> ${jobs.length}`);
    return jobs;
  } catch (e) { report.push(`lever:${token} -> ERR ${e.message}`); return []; }
}

async function fetchAshby(token, report) {
  try {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { report.push(`ashby:${token} -> HTTP ${res.status}`); return []; }
    const data = await res.json();
    const jobs = (data.jobs || []).map(j => ({
      title: j.title || "",
      company: token,
      location: j.location || (j.address?.postalAddress?.addressLocality) || "",
      url: j.jobUrl || j.applyUrl || "",
      description: stripHtml(j.descriptionPlain || j.descriptionHtml || ""),
      postedDate: j.publishedAt || j.updatedAt || "",
    }));
    report.push(`ashby:${token} -> ${jobs.length}`);
    return jobs;
  } catch (e) { report.push(`ashby:${token} -> ERR ${e.message}`); return []; }
}

// ---- 6. Jooble & JSearch (Optional) ----
async function fetchJooble(keywords, location, report) {
  if (!ENV.JOOBLE_API_KEY) return [];
  const url = `https://jooble.org/api/${ENV.JOOBLE_API_KEY}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, location, result_on_page: 25 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { report.push(`jooble:${location} -> HTTP ${res.status}`); return []; }
    const data = await res.json();
    const jobs = (data.jobs || []).map(j => ({
      title: j.title || "",
      company: j.company || `jooble:${location}`,
      location: j.location || location,
      url: j.link || "",
      description: stripHtml(j.snippet || ""),
      postedDate: j.updated || "",
    }));
    report.push(`jooble:${location} -> ${jobs.length}`);
    return jobs;
  } catch (e) { report.push(`jooble:${location} -> ERR ${e.message}`); return []; }
}

async function fetchJSearch(fullQuery, report) {
  if (!ENV.RAPIDAPI_KEY) return [];
  const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(fullQuery)}&num_pages=1&page=1&date_posted=month`;
  try {
    const res = await fetch(url, {
      headers: {
        "x-rapidapi-key": ENV.RAPIDAPI_KEY,
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { report.push(`jsearch:"${fullQuery}" -> HTTP ${res.status}`); return []; }
    const data = await res.json();
    const jobs = (data.data || []).map(j => ({
      title: j.job_title || "",
      company: j.employer_name || "",
      location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || "",
      url: j.job_apply_link || j.job_google_link || "",
      description: stripHtml(j.job_description || ""),
      postedDate: j.job_posted_at_timestamp ? new Date(j.job_posted_at_timestamp * 1000).toISOString() : "",
    }));
    report.push(`jsearch:"${fullQuery}" -> ${jobs.length}`);
    return jobs;
  } catch (e) { report.push(`jsearch:"${fullQuery}" -> ERR ${e.message}`); return []; }
}

// =============================================================================
// ROUND-ROBIN INTERLEAVE
// =============================================================================
function interleaveBySource(jobs) {
  const buckets = {};
  for (const j of jobs) {
    const key = (j.company || "unknown").toLowerCase();
    (buckets[key] = buckets[key] || []).push(j);
  }
  const order = Object.keys(buckets);
  for (let i = order.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    [order[i], order[k]] = [order[k], order[i]];
  }
  const out = [];
  let added = true, idx = 0;
  while (added) {
    added = false;
    for (const key of order) {
      const arr = buckets[key];
      if (idx < arr.length) { out.push(arr[idx]); added = true; }
    }
    idx++;
  }
  return out;
}

// =============================================================================
// ANALYZE & SAVE — Call career-intelligence-api
// =============================================================================
async function analyzeAndSave(job, report) {
  const description = job.description || "";
  const content = `Job Title: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\n\n${description}`.slice(0, 12000);
  if (/\bpost[\s-]?doc(toral)?\b/i.test(`${job.title} ${description}`)) {
    report.push(`skipped postdoc (found in body): ${job.title.slice(0, 40)}`);
    return false;
  }
  const payload = { content, url: job.url, title: job.title, postedDate: job.postedDate || "" };

  const MAX_TRIES = 3;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const res = await fetch(ENV.CAREER_ANALYZER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) return true;
      let bodySnippet = "";
      try { bodySnippet = (await res.text()).slice(0, 200); } catch {}
      const transient = res.status === 502 || res.status === 503 || res.status === 429
        || /503|high demand|RESOURCE_EXHAUSTED|overload/i.test(bodySnippet);
      if (transient && attempt < MAX_TRIES) {
        await sleep(attempt * 1800);
        continue;
      }
      report.push(`analyze FAIL ${res.status} (try ${attempt}) :: ${bodySnippet.slice(0, 120)} :: ${job.title.slice(0, 28)}`);
      return false;
    } catch (e) {
      if (attempt < MAX_TRIES) { await sleep(attempt * 1800); continue; }
      report.push(`analyze ERR ${e.message}: ${job.title.slice(0, 40)}`);
      return false;
    }
  }
  return false;
}

// =============================================================================
// MAIN DISCOVERY RUN
// =============================================================================
async function main() {
  requireEnv(["CF_ACCOUNT_ID", "CF_API_TOKEN", "CF_KV_NAMESPACE_ID", "CAREER_ANALYZER_URL"]);
  const report = [];
  let collected = [];

  // 1. INDIA BIOPHARMA: BioTecNika
  if (CONFIG.BIOTECNIKA_ENABLED) {
    for (const feedUrl of CONFIG.BIOTECNIKA_FEEDS) {
      collected.push(...await fetchBioTecNika(feedUrl, report));
      await sleep(100);
    }
  }

  // 2. INDIA BIOPHARMA: LinkedIn India Guest Search
  if (CONFIG.LINKEDIN_ENABLED) {
    let linkedInIndiaCount = 0;
    for (const location of CONFIG.LINKEDIN_INDIA_LOCATIONS) {
      for (const query of CONFIG.LINKEDIN_INDIA_QUERIES) {
        let cards = [];
        try {
          cards = await searchLinkedIn(query, location);
        } catch (e) {
          report.push(`linkedin:india:"${query}" in ${location} -> ERR ${e.message}`);
          continue;
        }
        for (const card of cards.slice(0, CONFIG.LINKEDIN_MAX_PER_QUERY)) {
          const sk = seenKey(card.url);
          if (await kvGet(sk)) continue;
          collected.push({
            id: card.id,
            title: card.title,
            company: card.company,
            location: card.location,
            url: card.url,
            description: card.title,
            postedDate: "",
            thinText: true,
            isLinkedIn: true,
          });
          linkedInIndiaCount++;
        }
        await sleep(150);
      }
    }
    report.push(`linkedin:india -> ${linkedInIndiaCount} postings harvested`);
  }

  // 3. ABROAD PHD ONLY: LinkedIn International PhD Positions
  if (CONFIG.LINKEDIN_ENABLED) {
    let linkedInPhdCount = 0;
    for (const location of CONFIG.LINKEDIN_PHD_LOCATIONS) {
      for (const query of CONFIG.LINKEDIN_PHD_QUERIES) {
        let cards = [];
        try {
          cards = await searchLinkedIn(query, location);
        } catch (e) {
          report.push(`linkedin:phd:"${query}" in ${location} -> ERR ${e.message}`);
          continue;
        }
        for (const card of cards.slice(0, CONFIG.LINKEDIN_MAX_PER_QUERY)) {
          const sk = seenKey(card.url);
          if (await kvGet(sk)) continue;
          collected.push({
            id: card.id,
            title: card.title,
            company: card.company,
            location: card.location,
            url: card.url,
            description: card.title,
            postedDate: "",
            thinText: true,
            isLinkedIn: true,
          });
          linkedInPhdCount++;
        }
        await sleep(150);
      }
    }
    report.push(`linkedin:abroad_phd -> ${linkedInPhdCount} postings harvested`);
  }

  // 4. ABROAD PHD ONLY: jobRxiv Doctoral Feeds
  if (CONFIG.JOBRXIV_ENABLED) {
    for (const kw of CONFIG.JOBRXIV_KEYWORDS) {
      collected.push(...await fetchJobRxiv(kw, report));
      await sleep(100);
    }
  }

  // 5. ADZUNA: India Jobs (Naukri, Indeed, Monster aggregates) + Abroad PhD Only
  if (CONFIG.ADZUNA_ENABLED && ENV.ADZUNA_APP_ID && ENV.ADZUNA_APP_KEY) {
    // India industry queries (fires every run)
    for (const query of CONFIG.ADZUNA_INDIA_QUERIES) {
      collected.push(...await fetchAdzuna("in", query, report));
      await sleep(100);
    }
    // Abroad queries: STRICTLY PhD / Doctoral Positions
    const phdSlice = await pickInternationalAdzunaSlice();
    for (const { country, query } of phdSlice) {
      collected.push(...await fetchAdzuna(country, query, report));
      await sleep(100);
    }
  }

  // 6. ATS Biotechs (Direct company boards)
  for (const t of CONFIG.ATS.greenhouse) collected.push(...await fetchGreenhouse(t, report));
  for (const t of CONFIG.ATS.lever) collected.push(...await fetchLever(t, report));
  for (const t of CONFIG.ATS.ashby) collected.push(...await fetchAshby(t, report));

  // 7. Optional Aggregators (Jooble India & JSearch)
  if (CONFIG.JOOBLE_ENABLED && ENV.JOOBLE_API_KEY) {
    for (const loc of CONFIG.JOOBLE_LOCATIONS) {
      collected.push(...await fetchJooble(CONFIG.JOOBLE_KEYWORDS, loc, report));
      await sleep(150);
    }
  }
  if (CONFIG.JSEARCH_ENABLED && ENV.RAPIDAPI_KEY) {
    for (const q of CONFIG.JSEARCH_INDIA_QUERIES) {
      collected.push(...await fetchJSearch(q, report));
      await sleep(150);
    }
    for (const q of CONFIG.JSEARCH_PHD_QUERIES) {
      collected.push(...await fetchJSearch(q, report));
      await sleep(150);
    }
  }

  report.push(`--- collected ${collected.length} raw postings ---`);

  // ---- Balance via round-robin ---------------------------------------------
  collected = interleaveBySource(collected);

  // ---- Filter + Dedup + Direct Apply + Analyze -----------------------------
  let analyzed = 0, passed = 0, dupes = 0;
  const srcStats = {};
  const bump = (c, field) => {
    const k = (c || "?").toLowerCase();
    (srcStats[k] = srcStats[k] || { seen: 0, filtered: 0, analyzed: 0 })[field]++;
  };

  for (const job of collected) {
    if (analyzed >= CONFIG.MAX_ANALYZE_PER_RUN) {
      report.push(`hit MAX_ANALYZE_PER_RUN (${CONFIG.MAX_ANALYZE_PER_RUN} jobs analyzed) — remaining roll to next run`);
      break;
    }
    if (!job.url) continue;
    bump(job.company, "seen");

    if (job.thinText) {
      if (!thinTextWorthAnalyzing(job.title)) { bump(job.company, "filtered"); continue; }
    } else {
      const blob = `${job.title} ${job.location} ${job.description}`;
      if (!prefilterPass(blob, 2)) { bump(job.company, "filtered"); continue; }
    }
    passed++;

    const sk = seenKey(job.url);
    const fp = fingerprintKey(job);
    try {
      if (await kvGet(sk)) { dupes++; continue; }
      if (await kvGet(fp)) {
        dupes++;
        report.push(`dup (cross-source): ${job.title.slice(0, 40)}`);
        continue;
      }
    } catch (e) {
      report.push(`KV read error: ${e.message}`);
    }

    // Just-in-time LinkedIn detail fetch
    if (job.isLinkedIn && job.id && job.description === job.title) {
      try {
        const detail = await fetchLinkedInDetail(job.id);
        if (detail.snippet) {
          job.description = detail.snippet;
          job.thinText = false;
        }
        if (detail.postedDate) job.postedDate = detail.postedDate;
      } catch (e) {
        report.push(`linkedin detail error (${job.id}): ${e.message}`);
      }
    }

    // Direct Apply link resolution for aggregator links
    if (/adzuna\.|jooble\.org/i.test(job.url)) {
      try {
        const directUrl = await resolveDirectApplyUrl(job.url);
        if (directUrl && directUrl !== job.url) {
          job.url = directUrl;
        }
      } catch {}
    }

    const ok = await analyzeAndSave(job, report);
    if (ok) {
      analyzed++;
      console.log(`[progress] Analyzed job ${analyzed}/${CONFIG.MAX_ANALYZE_PER_RUN}: ${job.company} - ${job.title}`);
      bump(job.company, "analyzed");

      // Write dedup keys ONLY on successful analysis
      try {
        await kvPut(sk, String(Date.now()), CONFIG.SEEN_TTL_SECONDS);
        await kvPut(fp, String(Date.now()), CONFIG.SEEN_TTL_SECONDS);
      } catch (e) {
        report.push(`KV write error: ${e.message}`);
      }
    }
  }

  const sourceDiag = Object.keys(srcStats).sort().map(k => {
    const s = srcStats[k];
    return `${k}: seen ${s.seen}, filtered-out ${s.filtered}, analyzed ${s.analyzed}`;
  });

  const summary = {
    ranAt: new Date().toISOString(),
    rawCollected: collected.length,
    passedPrefilter: passed,
    skippedDuplicates: dupes,
    analyzedAndSaved: analyzed,
    perSource: report,
    sourceDiagnostics: sourceDiag,
  };

  try {
    await kvPut("discovery:last_run", JSON.stringify(summary));
  } catch (e) {
    console.error("Failed to save summary:", e.message);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => {
  console.error("Fatal error during discovery:", e);
  process.exit(1);
});
