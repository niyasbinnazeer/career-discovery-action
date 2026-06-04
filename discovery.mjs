// discovery.mjs — Node.js port of the Cloudflare discovery worker, designed to
// run as a GitHub Actions scheduled job (no Cloudflare Workers subrequest cap).
//
// HOW IT DIFFERS FROM THE WORKER VERSION:
//   * KV access goes through Cloudflare's REST API (auth: CF API token + account ID)
//     instead of `env.JOBS_KV` binding. ~100-200ms per op vs in-process; bearable.
//   * Analyzer is called via its public URL (CAREER_ANALYZER_URL) instead of a
//     service binding. Same POST body, same response handling.
//   * Secrets come from process.env (set via GitHub repo Settings → Secrets).
//   * No 50-subrequest cap, so MAX_ANALYZE_PER_RUN is raised dramatically.
//   * `scheduled()` and `fetch()` handlers replaced by a single `main()`.
//
// SECRETS REQUIRED (set as GitHub Actions repo secrets):
//   CF_ACCOUNT_ID          — your Cloudflare account ID
//   CF_API_TOKEN           — API token with KV read+write on `career_jobs`
//   CF_KV_NAMESPACE_ID     — KV namespace ID of `career_jobs`
//   CAREER_ANALYZER_URL    — https://career-intelligence-api.<sub>.workers.dev
//   ADZUNA_APP_ID
//   ADZUNA_APP_KEY
//
// Run locally for testing:  node discovery.mjs

// =============================================================================
// CONFIG — same shape as the Worker version
// =============================================================================
const CONFIG = {
  // No subrequest cap on GitHub Actions. Raised to 40 to handle the bigger pool
  // now that India queries fire every run. At 12 cron runs/day × 40 = 480 jobs
  // analyzed/day max — within Gemini Flash-Lite free tier (500/day) with margin;
  // Haiku absorbs overflow if Gemini hits its cap.
  MAX_ANALYZE_PER_RUN: 40,

  // Job dedup keys persist in KV for 120 days, then expire — long enough that
  // re-postings of the same job don't trigger duplicate analysis.
  SEEN_TTL_SECONDS: 60 * 60 * 24 * 120,

  // Auto-rotate the analysis order across sources so each run is balanced.
  ATS: {
    greenhouse: [
      // Verified working
      "twistbioscience", "manifoldbio", "genscript", "remixtherapeutics",
      "shennonbiotechnologies", "absci", "generatebiomedicines",
      "xairatherapeutics", "voyagertherapeutics",
      // New additions — best-guess tokens for biotechs known to use Greenhouse.
      // The fetchGreenhouse adapter handles 404s gracefully (reports the error
      // and continues), so adding probable tokens is safe: working ones add
      // jobs, broken ones are silently ignored.
      "recursionpharmaceuticals", // Recursion — AI-driven drug discovery
      "virbio",                   // Vir Biotechnology — infectious disease
      "sanabiotechnology",        // Sana — cell therapy
      "vorbiopharma",             // Vor — hematology
      "lyellimmunopharma",        // Lyell — cell therapy for cancer
      "schrodinger",              // Schrödinger — computational drug discovery
      "arcusbio",                 // Arcus — oncology
      "insitro",                  // insitro — ML-driven drug discovery
    ],
    lever: [],
    ashby: [],
  },

  ADZUNA_ENABLED: true,
  // 12 countries now — added Italy (biotech hubs Milan/Rome, Roche/Novartis
  // subsidiaries) and New Zealand (English-speaking, biotech presence).
  ADZUNA_COUNTRIES: ["in","gb","de","us","ca","au","ch","nl","fr","sg","it","nz"],
  // Global queries — REBALANCED 70/30 toward wet-lab as requested.
  // Wet-lab/protein sciences (9 queries) :: Bioinformatics (3) :: Generic (2) :: PhD (4)
  // 9 wet-lab / (9+3+2) = 64% of domain queries; with India-every-run also wet-lab
  // biased, the analyzed pool ends up roughly 70/30 wet-lab over time.
  ADZUNA_QUERIES: [
    // WET-LAB / PROTEIN SCIENCES — 9 queries
    "antibody purification",
    "protein purification",
    "mAb scientist",
    "AKTA chromatography",
    "bioprocess scientist",
    "downstream processing",
    "biologics manufacturing",
    "upstream downstream processing",
    "antibody engineering",
    // BIOINFORMATICS — 3 queries (down from 4)
    "bioinformatics scientist",
    "computational biology",
    "NGS bioinformatics",
    // GENERIC — 2 queries (broad biology/biotech roles)
    "research scientist biotech",
    "molecular biology scientist",
    // PhD positions — 4 queries (mix of wet-lab and computational)
    "PhD protein engineering",
    "PhD bioinformatics",
    "PhD computational biology",
    "doctoral researcher biology",
  ],
  // India-specific queries — fire on EVERY run, regardless of rotation, because
  // Indian biopharma roles are underrepresented in the global queries and Naukri/
  // LinkedIn-style content shows up under more local phrasing. REBALANCED 70/30
  // wet-lab as requested: 6 wet-lab + 2 bioinformatics.
  ADZUNA_INDIA_QUERIES: [
    // Wet-lab (6)
    "protein purification",
    "antibody scientist",
    "downstream processing biotech",
    "quality control biologics",
    "biopharma scientist",
    "biotech research associate",
    // Bioinformatics (2)
    "bioinformatics scientist",
    "computational biology",
  ],
  // Per-run cap on Adzuna rotation calls. India queries (8) fire every run in
  // addition. Total per run: 8 India + 8 rotation = 16 Adzuna calls.
  ADZUNA_CALLS_PER_RUN: 8,
  ADZUNA_RESULTS_PER_CALL: 25,
  ADZUNA_MAX_DAYS_OLD: 30,
};

// =============================================================================
// SECRETS — pulled from process.env (set as GitHub Actions repo secrets)
// =============================================================================
const ENV = {
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
  CF_API_TOKEN: process.env.CF_API_TOKEN,
  CF_KV_NAMESPACE_ID: process.env.CF_KV_NAMESPACE_ID,
  CAREER_ANALYZER_URL: process.env.CAREER_ANALYZER_URL,
  ADZUNA_APP_ID: process.env.ADZUNA_APP_ID,
  ADZUNA_APP_KEY: process.env.ADZUNA_APP_KEY,
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
// KEYWORD FILTERS — same as worker version
// =============================================================================
const STRONG_POSITIVE = [
  "protein purification","monoclonal antibod","mab","bispecific","antibody",
  "akta","fplc","chromatograph","protein a","affinity","ion exchange",
  "downstream process","tff","ultrafiltration","diafiltration","sec-hplc",
  "bioprocess","biologics","endotoxin","purification",
  "bioinformatic","ngs","qiime","16s","microbiome","computational biolog",
  "genomic","transcriptomic","multi-omic","rna-seq","sequencing",
  "alphafold","structural biolog","protein engineering","neurogenetic",
];
const PHD_POSITIVE = ["phd","ph.d","doctoral","research fellow"];
const HARD_NEGATIVE = [
  "sales","business development","account manager","medical coding","billing",
  "call center","call centre","customer support","customer relationship",
  "recruiter","recruitment","data entry","telecaller","bpo","insurance",
  "real estate","marketing manager","marketing campaigns","media specialist",
  "global marketing","product manager","product management","commodity business",
  "warehouse","logistics","procurement","supply chain","treasury","customs",
  "trade compliance","import & export","import and export","facility project",
  "construction project","general affairs","ehs manager","lab supervisor",
  "lab technician","order management","material transfer",
  "legal counsel","legal intern","corporate legal","sap engineer","sap ",
  "it support","it engineer","biostatistics","program team lead",
  "surfactant","fmcg","cattle","veterinary","nursing",
  "postdoc","post-doc","post doctoral","postdoctoral",
];

function prefilterPass(text, minScore = 2) {
  const t = (text || "").toLowerCase();
  if (t.length < 40) return false;
  let score = 0;
  for (const kw of STRONG_POSITIVE) if (t.includes(kw)) score += 2;
  for (const kw of PHD_POSITIVE) if (t.includes(kw)) score += 1;
  for (const kw of HARD_NEGATIVE) if (t.includes(kw)) score -= 3;
  return score >= minScore;
}

function thinTextWorthAnalyzing(title) {
  const t = (title || "").toLowerCase().trim();
  if (t.length < 8) return false;
  const JUNK = ["read more","apply now","apply here","view all","see all","login",
    "sign in","register","subscribe","newsletter","cookie","privacy","terms",
    "contact us","about us","home","next","previous","load more","search jobs",
    "search for jobs","saved jobs","jobs expiring","expiring soon","young investigators",
    "science communication","browse","filter","sort by","all jobs","my account",
    "create account","post a job","advertise","help","faq","sitemap","back to"];
  for (const j of JUNK) if (t === j || t.startsWith(j) || t.includes(j)) return false;
  for (const kw of HARD_NEGATIVE) if (t.includes(kw)) return false;
  const TOO_SENIOR = ["professor","faculty","dean","lecturer","chair ",
    "head of department","principal investigator","group leader","tenure"];
  for (const s of TOO_SENIOR) if (t.includes(s)) return false;
  const DOMAIN = ["protein","antibody","mab","purification","chromatograph",
    "downstream","bioprocess","biologic","bioinformatic","computational biolog",
    "genomic","genetic","microbiome","ngs","sequencing","molecular","biochem",
    "cell biolog","cell culture","immunolog","structural biolog","biotech",
    "biology","life science","omics","proteomic"];
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
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================================================
// CLOUDFLARE KV via REST API
// =============================================================================
const KV_BASE = () => `https://api.cloudflare.com/client/v4/accounts/${ENV.CF_ACCOUNT_ID}/storage/kv/namespaces/${ENV.CF_KV_NAMESPACE_ID}`;
const KV_HEADERS = () => ({ "Authorization": `Bearer ${ENV.CF_API_TOKEN}` });

async function kvGet(key) {
  const res = await fetch(`${KV_BASE()}/values/${encodeURIComponent(key)}`, { headers: KV_HEADERS() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV get ${key} -> ${res.status}`);
  return await res.text();
}

async function kvPut(key, value, ttlSeconds) {
  const url = `${KV_BASE()}/values/${encodeURIComponent(key)}` + (ttlSeconds ? `?expiration_ttl=${ttlSeconds}` : "");
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...KV_HEADERS(), "Content-Type": "text/plain" },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`KV put ${key} -> ${res.status}`);
}

// =============================================================================
// DEDUP KEYS — same shape as worker version
// =============================================================================
import { createHash } from "node:crypto";
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
// SOURCE ADAPTERS — Greenhouse, Lever, Ashby, Adzuna
// =============================================================================
async function fetchGreenhouse(token, report) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
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
    const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`);
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
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`);
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

async function fetchAdzuna(country, query, report) {
  if (!ENV.ADZUNA_APP_ID || !ENV.ADZUNA_APP_KEY) return [];
  const params = new URLSearchParams({
    app_id: ENV.ADZUNA_APP_ID, app_key: ENV.ADZUNA_APP_KEY,
    what: query, results_per_page: String(CONFIG.ADZUNA_RESULTS_PER_CALL),
    max_days_old: String(CONFIG.ADZUNA_MAX_DAYS_OLD),
    "content-type": "application/json",
  });
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`;
  try {
    const res = await fetch(url);
    if (!res.ok) { report.push(`adzuna:${country}:"${query}" -> HTTP ${res.status}`); return []; }
    const data = await res.json();
    const jobs = (data.results || []).map(j => ({
      title: j.title || "",
      company: `adzuna:${country}`,
      location: j.location?.display_name || (j.location?.area || []).slice(-2).join(", ") || "",
      url: j.redirect_url || "",
      description: (j.company?.display_name ? `Company: ${j.company.display_name}\n\n` : "") + stripHtml(j.description || ""),
      postedDate: j.created || "",
    }));
    report.push(`adzuna:${country}:"${query}" -> ${jobs.length}`);
    return jobs;
  } catch (e) { report.push(`adzuna:${country}:"${query}" -> ERR ${e.message}`); return []; }
}

async function pickAdzunaSlice() {
  const countries = CONFIG.ADZUNA_COUNTRIES;
  const queries = CONFIG.ADZUNA_QUERIES;
  const total = countries.length * queries.length;
  let cursor = 0;
  try {
    const stored = await kvGet("discovery:adzuna_cursor");
    if (stored) cursor = parseInt(stored, 10) || 0;
  } catch {}
  const slice = [];
  for (let i = 0; i < CONFIG.ADZUNA_CALLS_PER_RUN; i++) {
    const idx = (cursor + i) % total;
    const c = countries[idx % countries.length];
    const q = queries[Math.floor(idx / countries.length) % queries.length];
    slice.push({ country: c, query: q });
  }
  const newCursor = (cursor + CONFIG.ADZUNA_CALLS_PER_RUN) % total;
  try { await kvPut("discovery:adzuna_cursor", String(newCursor)); } catch {}
  return slice;
}

// =============================================================================
// ROUND-ROBIN INTERLEAVE — balance jobs across sources before analyzing
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
// ANALYZE & SAVE — calls the analyzer worker via its public URL
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
      });
      if (res.ok) return true;
      let bodySnippet = "";
      try { bodySnippet = (await res.text()).slice(0, 200); } catch {}
      const transient = res.status === 502 || res.status === 503 || res.status === 429
        || /503|high demand|RESOURCE_EXHAUSTED|overload/i.test(bodySnippet);
      if (transient && attempt < MAX_TRIES) {
        await new Promise(r => setTimeout(r, attempt * 1500));
        continue;
      }
      report.push(`analyze FAIL ${res.status} (try ${attempt}) :: ${bodySnippet.slice(0, 120)} :: ${job.title.slice(0, 28)}`);
      return false;
    } catch (e) {
      if (attempt < MAX_TRIES) { await new Promise(r => setTimeout(r, attempt * 1500)); continue; }
      report.push(`analyze ERR ${e.message}: ${job.title.slice(0, 40)}`);
      return false;
    }
  }
  return false;
}

// =============================================================================
// MAIN
// =============================================================================
async function main() {
  requireEnv(["CF_ACCOUNT_ID","CF_API_TOKEN","CF_KV_NAMESPACE_ID","CAREER_ANALYZER_URL"]);
  const report = [];
  let collected = [];

  // ---- 1. Collect from all sources ------------------------------------------
  for (const t of CONFIG.ATS.greenhouse) collected.push(...await fetchGreenhouse(t, report));
  for (const t of CONFIG.ATS.lever) collected.push(...await fetchLever(t, report));
  for (const t of CONFIG.ATS.ashby) collected.push(...await fetchAshby(t, report));
  if (CONFIG.ADZUNA_ENABLED && ENV.ADZUNA_APP_ID && ENV.ADZUNA_APP_KEY) {
    // India queries fire on EVERY run (in addition to rotation). This biases the
    // pipeline toward Indian biopharma roles, which are otherwise underrepresented
    // and which catch a lot of Naukri/LinkedIn-aggregated content that wouldn't
    // surface through the global queries.
    for (const query of CONFIG.ADZUNA_INDIA_QUERIES) {
      collected.push(...await fetchAdzuna("in", query, report));
    }
    // Rotation across the full country×query matrix — different slice each run.
    const slice = await pickAdzunaSlice();
    for (const { country, query } of slice) {
      collected.push(...await fetchAdzuna(country, query, report));
    }
  } else if (CONFIG.ADZUNA_ENABLED) {
    report.push("adzuna -> skipped (ADZUNA_APP_ID / ADZUNA_APP_KEY not set)");
  }
  report.push(`--- collected ${collected.length} raw postings ---`);

  // ---- 2. Balance via round-robin ------------------------------------------
  collected = interleaveBySource(collected);

  // ---- 3. Filter + dedup + analyze -----------------------------------------
  let analyzed = 0, passed = 0, dupes = 0, attempts = 0;
  const srcStats = {};
  const bump = (c, field) => { const k = (c||'?').toLowerCase(); (srcStats[k] = srcStats[k] || {seen:0,filtered:0,analyzed:0})[field]++; };

  for (const job of collected) {
    if (attempts >= CONFIG.MAX_ANALYZE_PER_RUN) {
      report.push(`hit MAX_ANALYZE_PER_RUN (${CONFIG.MAX_ANALYZE_PER_RUN} attempts) — remaining roll to next run`);
      break;
    }
    if (!job.url) continue;
    bump(job.company, 'seen');
    const blob = `${job.title} ${job.location} ${job.description}`;
    if (job.thinText) {
      if (!thinTextWorthAnalyzing(job.title)) { bump(job.company, 'filtered'); continue; }
    } else {
      if (!prefilterPass(blob, 2)) { bump(job.company, 'filtered'); continue; }
    }
    passed++;

    const sk = seenKey(job.url);
    const fp = fingerprintKey(job);
    try {
      if (await kvGet(sk)) { dupes++; continue; }
      if (await kvGet(fp)) { dupes++; report.push(`dup (cross-source): ${job.title.slice(0, 40)}`); continue; }
      // Mark seen BEFORE analyzing so a failed analyze doesn't cause retries on next run.
      await kvPut(sk, String(Date.now()), CONFIG.SEEN_TTL_SECONDS);
      await kvPut(fp, String(Date.now()), CONFIG.SEEN_TTL_SECONDS);
    } catch (e) {
      report.push(`KV error: ${e.message}`);
      continue;
    }

    attempts++;
    const ok = await analyzeAndSave(job, report);
    if (ok) { analyzed++; bump(job.company, 'analyzed'); }
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

  try { await kvPut("discovery:last_run", JSON.stringify(summary)); } catch (e) { console.error("Failed to save summary:", e.message); }

  // Print a copy to the GitHub Actions log for visibility.
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
