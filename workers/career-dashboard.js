// career-dashboard worker
// Cloudflare Worker serving the interactive Career Intelligence Dashboard for Sudakshina Deb.
const SECRET_KEY = "sudakshina-2026";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    const key = url.searchParams.get("key");
    if (key !== SECRET_KEY) {
      return new Response("Unauthorized. Add ?key=YOUR_SECRET to the URL.", {
        status: 401,
        headers: { "Content-Type": "text/plain" }
      });
    }

    if (url.pathname === "/api/jobs" && request.method === "GET") {
      try {
        let cursor = undefined;
        let allKeys = [];
        do {
          const page = await env.JOBS_KV.list({ prefix: "jobs:", limit: 1000, cursor });
          allKeys.push(...page.keys);
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);

        const jobs = [];
        const BATCH = 64;
        for (let i = 0; i < allKeys.length; i += BATCH) {
          const batch = allKeys.slice(i, i + BATCH);
          const values = await Promise.all(batch.map(k => env.JOBS_KV.get(k.name)));
          for (const v of values) {
            if (v) {
              try { jobs.push(JSON.parse(v)); } catch {}
            }
          }
        }
        jobs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return jsonResponse({ jobs, count: jobs.length });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/clear-all" && request.method === "POST") {
      try {
        let deleted = 0;
        let cursor = undefined;
        do {
          const page = await env.JOBS_KV.list({ limit: 1000, cursor });
          const keysToDelete = page.keys.filter(k => k.name.startsWith("jobs:") || k.name.startsWith("seen:") || k.name.startsWith("fp:"));
          for (const k of keysToDelete) {
            await env.JOBS_KV.delete(k.name);
            deleted++;
          }
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
        return jsonResponse({ ok: true, deleted });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (url.pathname.startsWith("/api/jobs/") && request.method === "PUT") {
      try {
        const id = url.pathname.split("/").pop();
        const updates = await request.json();
        const existing = await env.JOBS_KV.get(`jobs:${id}`);
        if (!existing) return jsonResponse({ error: "Not found" }, 404);
        const record = JSON.parse(existing);
        Object.assign(record, updates);
        if (updates.status === "applied" && !record.appliedAt) {
          record.appliedAt = Date.now();
        }
        await env.JOBS_KV.put(`jobs:${id}`, JSON.stringify(record));
        return jsonResponse({ ok: true, record });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (url.pathname.startsWith("/api/jobs/") && request.method === "DELETE") {
      try {
        const id = url.pathname.split("/").pop();
        await env.JOBS_KV.delete(`jobs:${id}`);
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/dedup" && request.method === "POST") {
      try {
        const list = await env.JOBS_KV.list({ prefix: "jobs:" });
        const records = [];
        for (const k of list.keys) {
          const v = await env.JOBS_KV.get(k.name);
          if (v) { try { records.push({ key: k.name, rec: JSON.parse(v) }); } catch {} }
        }
        // Group by normalized URL (ignore query string). Keep the NEWEST record
        // in each group, delete the rest. Records with no URL are left untouched.
        const groups = {};
        for (const r of records) {
          const u = (r.rec.url || "").split("?")[0];
          if (!u) continue;
          (groups[u] = groups[u] || []).push(r);
        }
        let deleted = 0;
        for (const u in groups) {
          const grp = groups[u];
          if (grp.length <= 1) continue;
          grp.sort((a, b) => (b.rec.timestamp || 0) - (a.rec.timestamp || 0)); // newest first
          for (let i = 1; i < grp.length; i++) { // delete all but the newest
            await env.JOBS_KV.delete(grp[i].key);
            deleted++;
          }
        }
        return jsonResponse({ ok: true, deleted, scanned: records.length });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    return new Response(DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

const DASHBOARD_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Career Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css">
<script src="https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#fafafa; --card:#ffffff; --border:#e5e5e5; --border-strong:#d4d4d8;
  --text:#18181b; --muted:#71717a; --subtle:#a1a1aa;
  --accent:#4f46e5; --accent-light:#eef2ff;
  --success:#16a34a; --success-light:#dcfce7;
  --warn:#d97706; --warn-light:#fef3c7;
  --danger:#dc2626; --danger-light:#fee2e2;
  --info:#0891b2; --info-light:#cffafe;
}
html,body{height:100%}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;
  background:var(--bg); color:var(--text); line-height:1.5;
  font-size:14px; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1280px; margin:0 auto; padding:32px 24px 60px}

/* HEADER */
.header{display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; gap:16px; flex-wrap:wrap}
.brand{display:flex; align-items:center; gap:12px; cursor:pointer}
.brand-icon{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;box-shadow:0 1px 3px rgba(79,70,229,0.3)}
.brand-text h1{font-size:20px;font-weight:600;letter-spacing:-0.02em;color:var(--text)}
.brand-text p{font-size:13px;color:var(--muted);margin-top:1px}
.header-actions{display:flex;gap:8px;align-items:center}

.btn-ghost{
  display:inline-flex; align-items:center; gap:6px;
  padding:8px 14px; background:var(--card); border:0.5px solid var(--border); border-radius:9px;
  font-size:13px; font-weight:500; color:var(--text); cursor:pointer; transition:all 0.15s;
}
.btn-ghost:hover{background:#f4f4f5; border-color:var(--border-strong)}
.btn-ghost i{font-size:14px; color:var(--muted)}

/* BREADCRUMB */
.breadcrumb{display:flex; align-items:center; gap:7px; font-size:13px; color:var(--muted); margin-bottom:20px}
.breadcrumb a{color:var(--accent); text-decoration:none; cursor:pointer}
.breadcrumb a:hover{text-decoration:underline}
.breadcrumb i{font-size:13px; color:var(--subtle)}

/* ============ LANDING ============ */
.landing-hero{text-align:center; padding:24px 0 28px}
.landing-hero h2{font-size:26px; font-weight:700; letter-spacing:-0.03em; margin-bottom:8px}
.landing-hero p{font-size:14px; color:var(--muted); max-width:520px; margin:0 auto}
.landing-search-wrap{max-width:580px; margin:22px auto 0; position:relative}
.landing-search-icon{position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; color:var(--muted)}
.landing-search-input{
  width:100%; padding:13px 18px 13px 46px; border-radius:12px; border:1px solid var(--border);
  background:var(--card); font-size:14px; color:var(--text); box-shadow:0 2px 10px rgba(0,0,0,0.03);
  font-family:inherit; outline:none; transition:all 0.18s ease;
}
.landing-search-input:focus{border-color:var(--accent); box-shadow:0 0 0 3px rgba(79,70,229,0.12)}
.landing-search-input::placeholder{color:var(--subtle)}

.section-cards{display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:32px}
.section-card{
  background:var(--card); border:0.5px solid var(--border); border-radius:18px;
  padding:26px 24px; cursor:pointer; transition:all 0.2s ease; position:relative; overflow:hidden;
  display:flex; flex-direction:column; gap:16px; min-height:200px;
}
.section-card:hover{border-color:var(--border-strong); box-shadow:0 4px 16px rgba(0,0,0,0.06); transform:translateY(-2px)}
.section-card::after{content:''; position:absolute; inset:0; opacity:0.04; pointer-events:none}
.sc-india::after{background:radial-gradient(circle at 80% 20%, #16a34a, transparent 60%)}
.sc-intl::after{background:radial-gradient(circle at 80% 20%, #4f46e5, transparent 60%)}
.sc-phd::after{background:radial-gradient(circle at 80% 20%, #d97706, transparent 60%)}
.sc-icon{width:48px; height:48px; border-radius:13px; display:flex; align-items:center; justify-content:center; font-size:24px}
.sc-india .sc-icon{background:var(--success-light); color:var(--success)}
.sc-intl .sc-icon{background:var(--accent-light); color:var(--accent)}
.sc-phd .sc-icon{background:var(--warn-light); color:var(--warn)}
.sc-body{flex:1}
.sc-title{font-size:18px; font-weight:600; letter-spacing:-0.02em; margin-bottom:4px}
.sc-sub{font-size:13px; color:var(--muted); line-height:1.5}
.sc-foot{display:flex; align-items:center; justify-content:space-between; padding-top:14px; border-top:0.5px solid var(--border)}
.sc-count{font-size:13px; color:var(--text); font-weight:600}
.sc-count span{color:var(--muted); font-weight:400}
.sc-arrow{color:var(--subtle); font-size:18px; transition:transform 0.15s}
.section-card:hover .sc-arrow{transform:translateX(3px); color:var(--accent)}

.landing-applied{
  background:var(--card); border:0.5px solid var(--border); border-radius:16px; padding:22px 24px;
  display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:0;
}

/* STATS BAR (reused) */
.stats-bar{
  background:var(--card); border:0.5px solid var(--border); border-radius:16px;
  padding:22px 24px; margin-bottom:24px;
  display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:0;
  position:relative; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.02);
}
.stat{padding:0 22px; position:relative}
.stat:not(:last-child)::after{content:''; position:absolute; right:0; top:50%; transform:translateY(-50%); width:1px; height:42px; background:var(--border)}
.stat-label{font-size:11px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.09em; margin-bottom:8px}
.stat-value{font-size:26px; font-weight:700; color:var(--text); letter-spacing:-0.03em; line-height:1}
.stat-change{font-size:11px; color:var(--subtle); margin-top:5px; font-weight:500}
.stat-apply .stat-value{color:var(--success)}
.stat-consider .stat-value{color:var(--warn)}
.stat-reject .stat-value{color:var(--danger)}

/* COUNTRY TABS */
.country-tabs{display:flex; gap:6px; margin-bottom:18px; flex-wrap:wrap; border-bottom:0.5px solid var(--border); padding-bottom:0}
.country-tab{
  padding:9px 15px; border:none; background:transparent; border-radius:9px 9px 0 0;
  font-size:13px; font-weight:500; color:var(--muted); cursor:pointer;
  display:inline-flex; align-items:center; gap:7px; transition:all 0.15s; position:relative; bottom:-0.5px;
  border-bottom:2px solid transparent;
}
.country-tab:hover{color:var(--text); background:#f4f4f5}
.country-tab.active{color:var(--accent); border-bottom-color:var(--accent); font-weight:600}
.country-tab .flag{font-size:15px}
.country-tab .count{font-size:11px; background:#f4f4f5; color:var(--muted); padding:1px 7px; border-radius:99px; font-weight:600}
.country-tab.active .count{background:var(--accent-light); color:var(--accent)}

/* CONTROLS (reused) */
.controls{display:flex; gap:10px; margin-bottom:18px; flex-wrap:wrap; align-items:center}
.search-wrap{position:relative; flex:1; min-width:240px}
.search-wrap i{position:absolute; left:13px; top:50%; transform:translateY(-50%); color:var(--subtle); font-size:15px; pointer-events:none}
.search-input{width:100%; padding:10px 14px 10px 38px; background:var(--card); border:0.5px solid var(--border); border-radius:10px; font-size:13px; color:var(--text); transition:border-color 0.15s; font-family:inherit}
.search-input:focus{outline:none; border-color:var(--accent)}
.search-input::placeholder{color:var(--subtle)}
.filter-group{display:flex; gap:5px; background:var(--card); padding:3px; border:0.5px solid var(--border); border-radius:10px}
.filter-pill{padding:7px 12px; border:none; background:transparent; border-radius:7px; font-size:12px; font-weight:500; color:var(--muted); cursor:pointer; display:inline-flex; align-items:center; gap:5px; transition:all 0.15s}
.filter-pill:hover{color:var(--text)}
.filter-pill.active{background:var(--text); color:#fff}
.filter-pill .count{font-size:10px; opacity:0.6; font-weight:500}
.sort-select{padding:9px 30px 9px 12px; background:var(--card) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2.5'><polyline points='6 9 12 15 18 9'/></svg>") no-repeat right 10px center; border:0.5px solid var(--border); border-radius:10px; font-size:13px; font-weight:500; color:var(--text); cursor:pointer; appearance:none; font-family:inherit}
.sort-select:focus{outline:none; border-color:var(--accent)}

/* JOB CARDS (reused) */
.jobs{display:flex; flex-direction:column; gap:8px}
.job{background:var(--card); border:0.5px solid var(--border); border-radius:14px; padding:16px 20px; display:grid; grid-template-columns:64px 1fr auto; gap:16px; align-items:center; cursor:pointer; transition:all 0.2s ease; position:relative}
.job:hover{border-color:var(--border-strong); box-shadow:0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02); transform:translateY(-1px)}
.score-badge{width:60px; height:60px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0; font-weight:700; font-size:19px; letter-spacing:-0.02em; border:3px solid}
.score-apply{background:#f0fdf4; color:#15803d; border-color:#86efac}
.score-consider{background:#fefce8; color:#a16207; border-color:#fde68a}
.score-reject{background:#fef2f2; color:#b91c1c; border-color:#fecaca}
.score-badge .score-pct{font-size:8px; opacity:0.75; font-weight:600; letter-spacing:0.06em; margin-top:-2px}
.job-main{min-width:0}
.job-title{font-size:15px; font-weight:600; color:var(--text); margin-bottom:6px; letter-spacing:-0.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.job-meta{display:flex; flex-wrap:wrap; gap:12px; font-size:12px; color:var(--muted); align-items:center}
.job-company{display:inline-flex; align-items:center; gap:5px; font-size:12.5px; color:var(--text); font-weight:600; letter-spacing:-0.005em}
.job-company i{font-size:13px; color:var(--accent); opacity:0.7}
.job-meta-item{display:inline-flex; align-items:center; gap:4px}
.job-meta-item i{font-size:12px; opacity:0.65}
.visa-chip{font-size:10.5px; padding:2px 8px; border-radius:99px; font-weight:600; display:inline-flex; align-items:center; gap:3px; border:0.5px solid}
.visa-Offered{background:var(--success-light); color:#15803d; border-color:#86efac}
.visa-Notoffered{background:var(--danger-light); color:#b91c1c; border-color:#fca5a5}
.visa-Notstated{background:#f4f4f5; color:var(--muted); border-color:var(--border)}
.job-tags{display:flex; gap:5px; margin-top:9px; flex-wrap:wrap}
.mini-tag{font-size:11px; padding:3px 8px; border-radius:6px; line-height:1.3; font-weight:500; display:inline-flex; align-items:center; gap:3px}
.mini-tag-s{background:#f0fdf4; color:#15803d}
.mini-tag-g{background:#fefce8; color:#a16207}
.job-side{display:flex; align-items:center; gap:8px; flex-shrink:0}
.status-select{padding:6px 24px 6px 10px; border-radius:7px; font-size:11px; font-weight:500; cursor:pointer; appearance:none; border:0.5px solid; font-family:inherit; background-position:right 7px center; background-repeat:no-repeat; background-size:9px; background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'><polyline points='6 9 12 15 18 9'/></svg>")}
.status-new{background:#fafafa; color:#71717a; border-color:#e5e5e5}
.status-applied{background:#eef2ff; color:#4338ca; border-color:#c7d2fe}
.status-interview{background:#fef3c7; color:#a16207; border-color:#fde68a}
.status-offered{background:#dcfce7; color:#15803d; border-color:#86efac}
.status-rejected{background:#fee2e2; color:#b91c1c; border-color:#fecaca}
.icon-btn{width:30px; height:30px; border:0.5px solid var(--border); border-radius:7px; background:var(--card); cursor:pointer; display:flex; align-items:center; justify-content:center; color:var(--muted); transition:all 0.15s}
.icon-btn:hover{background:#f4f4f5; color:var(--text)}
.icon-btn i{font-size:14px}

/* EMPTY / LOADING (reused) */
.empty{text-align:center; padding:70px 20px; color:var(--muted)}
.empty-icon{width:64px;height:64px;background:#f4f4f5;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--subtle);font-size:30px}
.empty h3{font-size:15px; color:var(--text); font-weight:500; margin-bottom:6px}
.empty p{font-size:13px; line-height:1.6}
.loading{text-align:center; padding:80px 20px}
.spin{width:36px; height:36px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.7s linear infinite; margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading p{font-size:13px; color:var(--muted)}

/* MODAL (reused) */
.drawer-bg{position:fixed; inset:0; background:rgba(24,24,27,0.45); backdrop-filter:blur(6px); display:none; z-index:100; opacity:0; transition:opacity 0.2s; align-items:flex-start; justify-content:center; padding:40px 20px; overflow-y:auto}
.drawer-bg.open{display:flex; opacity:1}
.drawer{background:var(--card); width:100%; max-width:600px; max-height:calc(100vh - 80px); overflow-y:auto; border-radius:18px; box-shadow:0 20px 50px rgba(0,0,0,0.15), 0 8px 16px rgba(0,0,0,0.08); transform:scale(0.96) translateY(10px); opacity:0; transition:all 0.22s ease-out; display:flex; flex-direction:column; margin:auto 0}
.drawer-bg.open .drawer{transform:scale(1) translateY(0); opacity:1}
.drawer-header{padding:32px 28px 24px; border-bottom:0.5px solid var(--border); background:linear-gradient(180deg, #fafafa 0%, #ffffff 100%); border-radius:18px 18px 0 0; text-align:center; position:relative}
.drawer-close{position:absolute; top:16px; right:16px; width:32px; height:32px; background:transparent; border:none; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:var(--muted); transition:all 0.15s}
.drawer-close:hover{background:#f4f4f5; color:var(--text)}
.drawer-close i{font-size:18px}
.score-ring-wrap{position:relative; width:128px; height:128px; margin:0 auto 16px}
.score-ring-bg{fill:none; stroke:#f4f4f5; stroke-width:8}
.score-ring-fg{fill:none; stroke-width:8; stroke-linecap:round; transform:rotate(-90deg); transform-origin:center; transition:stroke-dashoffset 0.8s ease-out}
.score-ring-num{position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center}
.score-ring-val{font-size:34px; font-weight:700; line-height:1; letter-spacing:-0.03em; color:var(--text)}
.score-ring-lbl{font-size:10px; color:var(--subtle); margin-top:3px; text-transform:uppercase; letter-spacing:0.08em; font-weight:600}
.drawer-rec-row{display:flex; justify-content:center; margin-bottom:14px}
.drawer-title{font-size:20px; font-weight:600; letter-spacing:-0.025em; line-height:1.25; color:var(--text); margin-bottom:5px}
.drawer-subtitle{font-size:12px; color:var(--muted); line-height:1.5}
.rec-pill{display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:500; border:0.5px solid; margin-top:6px}
.rec-Apply{background:var(--success-light); color:#166534; border-color:#86efac}
.rec-Consider{background:var(--warn-light); color:#92400e; border-color:#fcd34d}
.rec-Reject{background:var(--danger-light); color:#991b1b; border-color:#fca5a5}
.drawer-body{padding:20px 24px 80px}
.facts-grid{display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px}
.fact{background:linear-gradient(180deg, #fafafa 0%, #f4f4f5 100%); border:0.5px solid var(--border); border-radius:12px; padding:14px 16px; transition:all 0.15s}
.fact:hover{border-color:var(--border-strong)}
.fact-label{font-size:10px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.09em; margin-bottom:6px; display:flex; align-items:center; gap:5px}
.fact-label i{font-size:12px; color:var(--accent)}
.fact-value{font-size:14px; font-weight:500; color:var(--text); line-height:1.35; letter-spacing:-0.005em}
.fact-value.empty{color:var(--subtle); font-weight:400; font-style:italic; font-size:13px}
.signal-row{display:flex; gap:12px; align-items:flex-start; background:linear-gradient(180deg, #fafaff 0%, #f5f3ff 100%); border:0.5px solid #e9d5ff; border-radius:12px; padding:14px 16px; margin-bottom:22px}
.signal-row-icon{width:32px; height:32px; border-radius:9px; background:#ffffff; border:0.5px solid #d8b4fe; display:flex; align-items:center; justify-content:center; color:#7c3aed; font-size:16px; flex-shrink:0}
.signal-row-body{flex:1; min-width:0}
.signal-row-label{font-size:10px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.09em; margin-bottom:5px}
.signal-row-value{margin-bottom:6px}
.signal-row-note{font-size:12px; color:#52525b; line-height:1.55}
.section-d{margin-bottom:24px}
.section-d-title{font-size:11px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:12px; display:flex; align-items:center; gap:7px}
.section-d-title i{font-size:13px; color:var(--accent)}
.section-body{font-size:13px; color:var(--text); line-height:1.65}
.tag-list{display:flex; flex-wrap:wrap; gap:6px}
.tag{display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:6px 11px; border-radius:8px; line-height:1.3; border:0.5px solid; font-weight:500}
.tag i{font-size:11px}
.tag-s{background:#f0fdf4; color:#15803d; border-color:#bbf7d0}
.tag-g{background:#fefce8; color:#a16207; border-color:#fde68a}
.tip-list{display:flex; flex-direction:column; gap:8px}
.tip{display:flex; gap:12px; padding:12px 14px; background:var(--card); border-radius:11px; border:0.5px solid var(--border); transition:all 0.15s}
.tip:hover{border-color:var(--border-strong); background:#fafafa}
.tip-num{width:22px; height:22px; border-radius:50%; background:linear-gradient(135deg, var(--accent), #7c3aed); color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; flex-shrink:0; margin-top:1px; box-shadow:0 1px 2px rgba(79,70,229,0.2)}
.tip-text{font-size:13px; color:var(--text); line-height:1.55}
.checklist{display:flex; flex-direction:column; gap:6px}
.check-item{display:flex; gap:11px; padding:11px 14px; background:var(--card); border-radius:10px; border:0.5px solid var(--border); cursor:pointer; transition:all 0.15s; align-items:flex-start}
.check-item:hover{border-color:var(--border-strong); background:#fafafa}
.check-item.done{background:#f0fdf4; border-color:#bbf7d0}
.check-item.done .check-text{color:#15803d; text-decoration:line-through; opacity:0.7}
.check-box{width:19px; height:19px; border:1.5px solid var(--border-strong); border-radius:6px; flex-shrink:0; display:flex; align-items:center; justify-content:center; margin-top:1px; transition:all 0.15s}
.check-item.done .check-box{background:var(--success); border-color:var(--success); color:#fff}
.check-box i{font-size:12px; opacity:0; transition:opacity 0.15s}
.check-item.done .check-box i{opacity:1}
.check-text{font-size:13px; color:var(--text); line-height:1.5; flex:1}
.notes-textarea{width:100%; min-height:80px; padding:12px 14px; background:var(--card); border:0.5px solid var(--border); border-radius:10px; font-family:inherit; font-size:13px; line-height:1.5; color:var(--text); resize:vertical}
.notes-textarea:focus{outline:none; border-color:var(--accent)}
.notes-status{font-size:11px; color:var(--muted); margin-top:6px; height:14px}
.signal-badge{display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:7px; font-size:12px; font-weight:500; border:0.5px solid}
.signal-Top{background:#dcfce7; color:#15803d; border-color:#86efac}
.signal-Good{background:#dbeafe; color:#1e40af; border-color:#93c5fd}
.signal-Unknown{background:#f4f4f5; color:#52525b; border-color:#d4d4d8}
.signal-Caution{background:#fee2e2; color:#b91c1c; border-color:#fecaca}
.drawer-footer{position:sticky; bottom:0; background:var(--card); border-top:0.5px solid var(--border); padding:14px 24px; display:flex; gap:8px; border-radius:0 0 18px 18px}
.btn-primary{flex:1; padding:11px 16px; background:var(--text); color:#fff; border:none; border-radius:10px; font-size:13px; font-weight:500; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; transition:opacity 0.15s; font-family:inherit}
.btn-primary:hover{opacity:0.85}
.btn-primary i{font-size:14px}
.btn-danger{padding:11px 14px; background:var(--card); color:var(--danger); border:0.5px solid #fca5a5; border-radius:10px; font-size:13px; font-weight:500; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all 0.15s; font-family:inherit}
.btn-danger:hover{background:var(--danger-light)}

@media (max-width: 860px){
  .section-cards{grid-template-columns:1fr}
  .stats-bar{grid-template-columns:repeat(2, 1fr); gap:14px}
  .stat:not(:last-child)::after{display:none}
  .stat{padding:0}
  .job{grid-template-columns:48px 1fr; gap:12px}
  .job-side{grid-column:1/-1; justify-content:flex-end}
  .facts-grid{grid-template-columns:1fr}
  .drawer{max-width:100%}
}

/* ============ TAILOR & RESUME STUDIO ============ */
.tailor-card{
  background:linear-gradient(135deg, #fdf4ff 0%, #f5f3ff 50%, #eff6ff 100%);
  border:1px solid #d8b4fe; border-radius:14px; padding:16px 18px; margin-bottom:22px;
  box-shadow:0 2px 8px rgba(124, 58, 237, 0.06);
}
.tailor-head{display:flex; align-items:center; gap:12px; margin-bottom:12px}
.tailor-icon{
  width:36px; height:36px; border-radius:10px;
  background:linear-gradient(135deg, #9333ea, #4f46e5); color:#ffffff;
  display:flex; align-items:center; justify-content:center; font-size:18px;
  flex-shrink:0; box-shadow:0 2px 4px rgba(124, 58, 237, 0.25);
}
.tailor-title{font-size:14px; font-weight:700; color:#1e1b4b; letter-spacing:-0.01em}
.tailor-sub{font-size:12px; color:#6b7280; line-height:1.4; margin-top:2px}
.tailor-btns{display:flex; flex-wrap:wrap; gap:8px}
.btn-tailor{
  display:inline-flex; align-items:center; gap:6px; padding:8px 13px;
  border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer;
  border:0.5px solid; transition:all 0.15s ease; font-family:inherit;
}
.btn-tailor-primary{
  background:#7c3aed; color:#ffffff; border-color:#6d28d9;
  box-shadow:0 1px 3px rgba(124, 58, 237, 0.2);
}
.btn-tailor-primary:hover{background:#6d28d9}
.btn-tailor-secondary{background:#ffffff; color:#4338ca; border-color:#c7d2fe}
.btn-tailor-secondary:hover{background:#eef2ff; border-color:#a5b4fc}

/* ============ RESUME MODAL ============ */
.modal-bg{
  position:fixed; inset:0; background:rgba(0,0,0,0.55); backdrop-filter:blur(4px);
  display:none; align-items:center; justify-content:center; z-index:1050; padding:20px;
}
.modal-bg.open{display:flex}
.resume-modal{
  background:var(--card); border-radius:16px; width:100%; max-width:840px; max-height:90vh;
  display:flex; flex-direction:column; box-shadow:0 20px 48px rgba(0,0,0,0.22);
  border:0.5px solid var(--border); overflow:hidden; animation:modalPop 0.18s ease-out;
}
@keyframes modalPop{ from{opacity:0; transform:scale(0.96)} to{opacity:1; transform:scale(1)} }
.resume-modal-header{
  padding:18px 24px; border-bottom:0.5px solid var(--border); display:flex;
  align-items:flex-start; justify-content:space-between; gap:16px;
}
.resume-modal-tag{
  font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em;
  color:var(--accent); margin-bottom:4px; display:inline-flex; align-items:center; gap:5px;
}
.resume-modal-title{font-size:17px; font-weight:700; color:var(--text); letter-spacing:-0.01em}
.resume-modal-sub{font-size:13px; color:var(--muted); margin-top:2px}
.resume-modal-toolbar{
  padding:10px 24px; background:#fafafa; border-bottom:0.5px solid var(--border);
  display:flex; gap:8px; flex-wrap:wrap; align-items:center;
}
.resume-modal-content{flex:1; overflow:hidden; display:flex; padding:16px 24px 20px}
.resume-text-view{
  width:100%; height:55vh; padding:16px; border-radius:10px; border:0.5px solid var(--border);
  background:#ffffff; color:#18181b; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size:12.5px; line-height:1.6; resize:none; outline:none; white-space:pre-wrap;
  box-shadow:inset 0 1px 2px rgba(0,0,0,0.03);
}
.resume-text-view:focus{border-color:var(--accent)}

/* ============ TOAST ============ */
.toast{
  position:fixed; bottom:28px; left:50%; transform:translateX(-50%) translateY(100px);
  background:#18181b; color:#fff; padding:10px 20px; border-radius:99px;
  font-size:13px; font-weight:500; display:flex; align-items:center; gap:8px;
  box-shadow:0 8px 24px rgba(0,0,0,0.25); z-index:9999; opacity:0; pointer-events:none;
  transition:all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast.show{transform:translateX(-50%) translateY(0); opacity:1}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="brand" onclick="goHome()">
      <div class="brand-icon"><i class="ti ti-sparkles"></i></div>
      <div class="brand-text">
        <h1>Career Dashboard</h1>
        <p>Sudakshina Deb</p>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn-ghost" onclick="load()" title="Refresh"><i class="ti ti-refresh"></i>Refresh</button>
      <button class="btn-ghost" onclick="dedupJobs()" title="Remove duplicate entries"><i class="ti ti-copy-off"></i>Remove duplicates</button>
      <button class="btn-ghost" onclick="exportCSV()"><i class="ti ti-download"></i>Export</button>
    </div>
  </div>

  <div id="view"></div>
</div>

<div class="drawer-bg" id="drawer-bg" onclick="if(event.target===this)closeDrawer()">
  <div class="drawer" id="drawer"></div>
</div>

<div class="modal-bg" id="resume-modal-bg" onclick="if(event.target===this)closeResumeModal()">
  <div class="resume-modal" id="resume-modal">
    <div class="resume-modal-header">
      <div>
        <div class="resume-modal-tag"><i class="ti ti-sparkles"></i> ATS Tailored Document</div>
        <div class="resume-modal-title" id="resume-modal-job-title">Job Title</div>
        <div class="resume-modal-sub" id="resume-modal-company">Company</div>
      </div>
      <button class="drawer-close" onclick="closeResumeModal()"><i class="ti ti-x"></i></button>
    </div>
    <div class="resume-modal-toolbar">
      <button class="btn-ghost" style="background:#7c3aed;color:#ffffff;font-weight:600" onclick="downloadModalDocx()"><i class="ti ti-file-text"></i> Download .docx (Word)</button>
      <button class="btn-ghost" onclick="downloadCoverLetterDocx()"><i class="ti ti-mail-forward"></i> Cover Letter (.docx)</button>
      <button class="btn-ghost" onclick="copyColdOutreach(currentDetailId)"><i class="ti ti-brand-linkedin"></i> Copy InMail / Outreach</button>
      <button class="btn-ghost" onclick="copyModalResume()"><i class="ti ti-copy"></i> Copy Markdown</button>
      <button class="btn-ghost" onclick="downloadModalResume()"><i class="ti ti-download"></i> .md</button>
      <button class="btn-ghost" onclick="copyResumePrompt(currentDetailId)"><i class="ti ti-robot"></i> AI Prompt</button>
      <button class="btn-ghost" onclick="openHiringManagerSearch(currentDetailId)"><i class="ti ti-search"></i> Find Hiring Manager</button>
    </div>
    <div class="resume-modal-content">
      <textarea id="resume-text-area" class="resume-text-view" spellcheck="false"></textarea>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
const KEY = new URLSearchParams(location.search).get('key');
let allJobs = [];
let currentDetailId = null;

// ---- view state ----
// route: 'home' | 'section'; section: 'india'|'international'|'phd'; country: tab key
let route = 'home';
let section = null;
let activeCountry = null;
let currentFilter = 'all';

// ---- country config per section ----
const FLAGS = {India:'🇮🇳', USA:'🇺🇸', Canada:'🇨🇦', UK:'🇬🇧', Germany:'🇩🇪', Europe:'🇪🇺', Australia:'🇦🇺', Japan:'🇯🇵', 'South Korea':'🇰🇷', China:'🇨🇳', Singapore:'🇸🇬', UAE:'🇦🇪', Remote:'🌐', Other:'📍'};
const INTL_COUNTRIES = ['USA','Canada','UK','Germany','Europe','Australia','Japan','South Korea','China','Singapore','UAE','Remote','Other'];
const PHD_COUNTRIES   = ['India','USA','Canada','UK','Germany','Europe','Australia','Japan','South Korea','China','Singapore','Remote','Other'];

// ---- classification helpers ----
function jobCountry(j){
  let c = (j.analysis && j.analysis.country) || '';
  const EURO = ['austria','finland','sweden','netherlands','italy','spain','switzerland',
    'belgium','denmark','norway','poland','ireland','portugal','czechia','czech republic',
    'greece','hungary','romania','france','luxembourg','iceland','estonia','slovenia'];
  if (c && EURO.includes(c.toLowerCase())) return 'Europe';
  if (c) return c;
  const loc = ((j.analysis && j.analysis.location) || '').toLowerCase();
  if (/bangalore|bengaluru|hyderabad|mumbai|delhi|pune|chennai|india|kolkata|noida/.test(loc)) return 'India';
  if (/dubai|abu dhabi|sharjah|uae|emirates/.test(loc)) return 'UAE';
  if (/london|cambridge, uk|oxford|manchester|uk|united kingdom|england|scotland/.test(loc)) return 'UK';
  if (/munich|berlin|germany|heidelberg|frankfurt/.test(loc)) return 'Germany';
  if (/japan|tokyo|kyoto|osaka|yokohama|tsukuba/.test(loc)) return 'Japan';
  if (/seoul|korea|daejeon/.test(loc)) return 'South Korea';
  if (/china|shanghai|beijing|suzhou|apac/.test(loc)) return 'China';
  if (/singapore/.test(loc)) return 'Singapore';
  if (/sydney|melbourne|australia|brisbane/.test(loc)) return 'Australia';
  if (/toronto|vancouver|montreal|canada|ottawa|, bc|, on/.test(loc)) return 'Canada';
  if (/boston|san francisco|new york|usa|united states|california|, ma|, ca|, or|, tx|, nj|, ny|, wa|, pa|, md|san diego|seattle|wilsonville|quincy|redwood|cambridge, ma|south san/.test(loc)) return 'USA';
  if (/paris|amsterdam|zurich|geneva|stockholm|copenhagen|madrid|barcelona|milan|italy|france|spain|netherlands|sweden|switzerland|belgium|denmark|austria|europe/.test(loc)) return 'Europe';
  if (/remote/.test(loc)) return 'Remote';
  return 'Other';
}
function isPostdoc(j){
  const a = j.analysis || {};
  const t = ((a.employmentType||'') + ' ' + (a.jobCategory||'') + ' ' + (a.actualRole||'') + ' ' + (j.pageTitle||'')).toLowerCase();
  return /postdoc|post-doc|post doctoral|postdoctoral/.test(t);
}
function isPhd(j){
  const a = j.analysis || {};
  const role = (a.actualRole||'').toLowerCase();
  const type = (a.employmentType||'').toLowerCase();
  const cat  = (a.jobCategory||'').toLowerCase();
  if (isPostdoc(j)) return false;
  return /\bphd\b|doctoral|ph\.d/.test(role)
      || type === 'phd'
      || /phd position|doctoral/.test(cat);
}
function sectionOf(j){
  if (isPhd(j)) return 'phd';
  return jobCountry(j) === 'India' ? 'india' : 'international';
}

async function load() {
  document.getElementById('view').innerHTML = '<div class="loading"><div class="spin"></div><p>Loading saved jobs…</p></div>';
  try {
    const res = await fetch('/api/jobs?key=' + encodeURIComponent(KEY));
    const data = await res.json();
    allJobs = data.jobs || [];
    render();
  } catch (e) {
    document.getElementById('view').innerHTML = '<div class="empty"><div class="empty-icon"><i class="ti ti-alert-circle"></i></div><h3>Could not load</h3><p>' + escapeHtml(e.message) + '</p></div>';
  }
}

function goHome(){ route='home'; section=null; activeCountry=null; render(); }
function openSection(s){
  route='section'; section=s; currentFilter='all';
  const countries = s==='india' ? ['India'] : s==='phd' ? PHD_COUNTRIES : INTL_COUNTRIES;
  const counts = sectionCountsByCountry(s);
  activeCountry = countries.find(c => counts[c] > 0) || countries[0];
  render();
}

function sectionJobs(s){ return allJobs.filter(j => !isPostdoc(j) && sectionOf(j) === s); }
function sectionCountsByCountry(s){
  const out = {};
  for (const j of sectionJobs(s)){ const c = jobCountry(j); out[c] = (out[c]||0)+1; }
  return out;
}

function render(){
  if (route === 'home') return renderHome();
  return renderSection();
}

// ============ HOME ============
function renderHome(){
  const india = sectionJobs('india').length;
  const intl = sectionJobs('international').length;
  const phd = sectionJobs('phd').length;
  const total = allJobs.length;
  const applied = allJobs.filter(j => ['applied','interview','offered'].includes(j.status)).length;
  const apply = allJobs.filter(j => j.analysis?.recommendation === 'Apply').length;

  document.getElementById('view').innerHTML =
    '<div class="landing-hero">' +
      '<h2>Where do you want to look?</h2>' +
      '<p>' + total + ' roles analyzed across India, international markets, and PhD positions. Pick a track or search all roles directly.</p>' +
      '<div class="landing-search-wrap">' +
        '<i class="ti ti-search landing-search-icon"></i>' +
        '<input class="landing-search-input" id="home-search" placeholder="Search all ' + total + ' roles (e.g. Biocon, Twist, Downstream, PhD, Bengaluru)..." oninput="handleHomeSearch(this.value)">' +
      '</div>' +
    '</div>' +
    '<div id="home-search-container" style="display:none;margin-bottom:32px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
        '<div style="font-weight:600;font-size:15px;color:var(--text)" id="home-search-count">0 matching roles</div>' +
        '<button class="btn-ghost" onclick="clearHomeSearch()"><i class="ti ti-x"></i> Clear search</button>' +
      '</div>' +
      '<div id="home-search-jobs" class="jobs"></div>' +
    '</div>' +
    '<div id="home-default-sections">' +
      '<div class="section-cards">' +
        sectionCard('india','ti-map-pin-filled','India','Industry & research roles across Bengaluru, Hyderabad and beyond.', india) +
        sectionCard('international','ti-world','International','US, Canada, UK, Germany, Australia, Korea, UAE & remote.', intl) +
        sectionCard('phd','ti-school','PhD & Postdoc','Doctoral and postdoc positions worldwide, by country.', phd) +
      '</div>' +
      '<div class="stats-bar">' +
        statBlock('Total analyzed', total, 'all jobs scored', '') +
        statBlock('Apply-tier', apply, 'high match (70+)', 'apply') +
        statBlock('Applied', applied, 'tracked in pipeline', '') +
      '</div>' +
    '</div>';
}
function sectionCard(s, icon, title, sub, count){
  return '<div class="section-card sc-' + (s==='international'?'intl':s) + '" onclick="openSection(\'' + s + '\')">' +
    '<div class="sc-icon"><i class="ti ' + icon + '"></i></div>' +
    '<div class="sc-body"><div class="sc-title">' + title + '</div><div class="sc-sub">' + sub + '</div></div>' +
    '<div class="sc-foot"><div class="sc-count">' + count + ' <span>role' + (count===1?'':'s') + '</span></div><i class="ti ti-arrow-right sc-arrow"></i></div>' +
  '</div>';
}

// ============ SECTION ============
function renderSection(){
  const titles = {india:'India', international:'International', phd:'PhD & Postdoc'};
  const countries = section==='india' ? ['India'] : section==='phd' ? PHD_COUNTRIES : INTL_COUNTRIES;
  const counts = sectionCountsByCountry(section);

  const visible = countries.filter(c => counts[c] > 0);
  const tabsHtml = (visible.length ? visible : countries.slice(0,1)).map(c =>
    '<button class="country-tab' + (c===activeCountry?' active':'') + '" onclick="setCountry(\'' + c.replace(/'/g,"\\'") + '\')">' +
      '<span class="flag">' + (FLAGS[c]||'📍') + '</span>' + c +
      '<span class="count">' + (counts[c]||0) + '</span>' +
    '</button>'
  ).join('');

  document.getElementById('view').innerHTML =
    '<div class="breadcrumb"><a onclick="goHome()">Home</a><i class="ti ti-chevron-right"></i><span>' + titles[section] + '</span></div>' +
    (section!=='india' ? '<div class="country-tabs">' + tabsHtml + '</div>' : '') +
    '<div class="controls">' +
      '<div class="search-wrap"><i class="ti ti-search"></i><input class="search-input" id="search" placeholder="Search role, company, or location…"></div>' +
      '<div class="filter-group">' +
        filterPill('all','All') + filterPill('Apply','Apply') + filterPill('Consider','Consider') + filterPill('Reject','Reject') +
      '</div>' +
      '<select class="sort-select" id="sort" onchange="renderList()">' +
        '<option value="score-desc">Highest score</option>' +
        '<option value="date-desc">Newest first</option>' +
        '<option value="date-asc">Oldest first</option>' +
        '<option value="score-asc">Lowest score</option>' +
      '</select>' +
    '</div>' +
    '<div id="jobs" class="jobs"></div>';

  document.getElementById('search').addEventListener('input', renderList);
  renderList();
}
function filterPill(f,label){
  return '<button class="filter-pill' + (f===currentFilter?' active':'') + '" onclick="setFilter(\'' + f + '\')">' + label + '</button>';
}
function setCountry(c){ activeCountry = c; renderSection(); }
function setFilter(f){ currentFilter = f; document.querySelectorAll('.filter-pill').forEach(p=>p.classList.toggle('active', p.textContent.trim().startsWith(f==='all'?'All':f))); renderList(); }

function currentList(){
  let list = sectionJobs(section);
  if (section !== 'india') list = list.filter(j => jobCountry(j) === activeCountry);
  if (currentFilter !== 'all') list = list.filter(j => j.analysis?.recommendation === currentFilter);
  const searchEl = document.getElementById('search');
  const search = searchEl ? searchEl.value.toLowerCase() : '';
  if (search) list = list.filter(j => {
    const a = j.analysis || {};
    return ((a.actualRole||'')+' '+(a.company||'')+' '+(a.location||'')+' '+(a.jobCategory||'')+' '+(j.pageTitle||'')).toLowerCase().includes(search);
  });
  const sortEl = document.getElementById('sort');
  const sort = sortEl ? sortEl.value : 'score-desc';
  list.sort((a,b)=>{
    if (sort==='date-desc') return (b.timestamp||0)-(a.timestamp||0);
    if (sort==='date-asc') return (a.timestamp||0)-(b.timestamp||0);
    if (sort==='score-desc') return (b.analysis?.matchScore||0)-(a.analysis?.matchScore||0);
    if (sort==='score-asc') return (a.analysis?.matchScore||0)-(b.analysis?.matchScore||0);
    return 0;
  });
  return list;
}

function renderJobCard(j) {
  const a = j.analysis || {};
  const score = a.matchScore || 0;
  const scoreClass = score >= 70 ? 'apply' : score >= 45 ? 'consider' : 'reject';
  const status = j.status || 'new';
  const company = a.company || '';
  const location = a.location || '';
  const exp = a.experienceRequired || '';
  const visa = a.visaSponsorship || '';
  const visaClass = visa.replace(/\s/g,'');
  const topStrength = (a.strengths || [])[0];
  const topGap = (a.gaps || [])[0];
  const posted = postedLabel(j.postedDate);
  return '<div class="job" onclick="openDetail(\'' + j.id + '\')">' +
    '<div class="score-badge score-' + scoreClass + '">' + score + '<span class="score-pct">MATCH</span></div>' +
    '<div class="job-main">' +
      '<div class="job-title">' + escapeHtml(a.actualRole || 'Unknown role') + '</div>' +
      '<div class="job-meta">' +
        (company ? '<span class="job-company"><i class="ti ti-building"></i>' + escapeHtml(company) + '</span>' : '') +
        (location ? '<span class="job-meta-item"><i class="ti ti-map-pin"></i>' + escapeHtml(location) + '</span>' : '') +
        (exp ? '<span class="job-meta-item"><i class="ti ti-briefcase"></i>' + escapeHtml(exp) + '</span>' : '') +
        (posted ? '<span class="job-meta-item"><i class="ti ti-calendar"></i>' + escapeHtml(posted) + '</span>' : '') +
        (visa ? '<span class="visa-chip visa-' + visaClass + '"><i class="ti ti-plane"></i>' + escapeHtml(visa) + '</span>' : '') +
      '</div>' +
      ((topStrength||topGap) ? '<div class="job-tags">' +
        (topStrength ? '<span class="mini-tag mini-tag-s">✓ ' + escapeHtml(topStrength) + '</span>' : '') +
        (topGap ? '<span class="mini-tag mini-tag-g">! ' + escapeHtml(topGap) + '</span>' : '') +
      '</div>' : '') +
    '</div>' +
    '<div class="job-side" onclick="event.stopPropagation()">' +
      '<select class="status-select status-' + status + '" onchange="updateStatus(\'' + j.id + '\', this.value)" title="Update status">' +
        '<option value="new"' + (status==='new'?' selected':'') + '>Not Applied</option>' +
        '<option value="applied"' + (status==='applied'?' selected':'') + '>Applied</option>' +
        '<option value="interview"' + (status==='interview'?' selected':'') + '>Interview</option>' +
        '<option value="offered"' + (status==='offered'?' selected':'') + '>Offered</option>' +
        '<option value="rejected"' + (status==='rejected'?' selected':'') + '>Rejected</option>' +
      '</select>' +
      (j.url ? '<button class="icon-btn" title="' + applyTooltip(j) + '" onclick="window.open(\'' + escapeHtml(applyUrl(j)) + '\', \'_blank\')"><i class="ti ti-external-link"></i></button>' : '') +
    '</div>' +
  '</div>';
}

function renderList(){
  const jobs = currentList();
  const host = document.getElementById('jobs');
  if (!host) return;
  if (jobs.length === 0){
    host.innerHTML = '<div class="empty"><div class="empty-icon"><i class="ti ti-inbox"></i></div><h3>Nothing here yet</h3><p>No roles in this view. Try another country tab or filter — or analyze more jobs.</p></div>';
    return;
  }
  host.innerHTML = jobs.map(j => renderJobCard(j)).join('');
}

function handleHomeSearch(query) {
  const q = (query || '').trim().toLowerCase();
  const searchContainer = document.getElementById('home-search-container');
  const defaultSections = document.getElementById('home-default-sections');
  const countEl = document.getElementById('home-search-count');
  const jobsEl = document.getElementById('home-search-jobs');
  if (!q) {
    if (searchContainer) searchContainer.style.display = 'none';
    if (defaultSections) defaultSections.style.display = 'block';
    return;
  }
  if (defaultSections) defaultSections.style.display = 'none';
  if (searchContainer) searchContainer.style.display = 'block';

  const matches = allJobs.filter(j => {
    const a = j.analysis || {};
    return ((a.actualRole||'') + ' ' + (a.company||'') + ' ' + (a.location||'') + ' ' + (a.jobCategory||'') + ' ' + (a.strengths||[]).join(' ') + ' ' + (j.pageTitle||'')).toLowerCase().includes(q);
  });

  matches.sort((a,b) => (b.analysis?.matchScore||0) - (a.analysis?.matchScore||0));

  if (countEl) countEl.textContent = matches.length + ' matching role' + (matches.length === 1 ? '' : 's');
  if (!matches.length) {
    if (jobsEl) jobsEl.innerHTML = '<div class="empty"><div class="empty-icon"><i class="ti ti-search"></i></div><h3>No matching roles found</h3><p>Try searching for a different company (e.g. Biocon), technique (e.g. AKTA), or role.</p></div>';
  } else {
    if (jobsEl) jobsEl.innerHTML = matches.map(j => renderJobCard(j)).join('');
  }
}

function clearHomeSearch() {
  const input = document.getElementById('home-search');
  if (input) input.value = '';
  handleHomeSearch('');
}

function statBlock(label, value, sub, variant) {
  return '<div class="stat stat-' + variant + '"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div><div class="stat-change">' + sub + '</div></div>';
}

// ============ DETAIL DRAWER ============
function openDetail(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  currentDetailId = id;
  const a = job.analysis || {};
  const score = a.matchScore || 0;
  const rec = a.recommendation || 'Unknown';
  const checkState = job.checklistState || {};
  const ringColor = score >= 70 ? '#16a34a' : score >= 45 ? '#f59e0b' : '#ef4444';
  const circumference = 2 * Math.PI * 50;
  const dashOffset = circumference - (score / 100) * circumference;

  document.getElementById('drawer').innerHTML =
    '<div class="drawer-header">' +
      '<button class="drawer-close" onclick="closeDrawer()"><i class="ti ti-x"></i></button>' +
      '<div class="score-ring-wrap"><svg width="128" height="128" viewBox="0 0 128 128">' +
        '<circle class="score-ring-bg" cx="64" cy="64" r="50"></circle>' +
        '<circle class="score-ring-fg" cx="64" cy="64" r="50" stroke="' + ringColor + '" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + dashOffset + '"></circle>' +
      '</svg><div class="score-ring-num"><div class="score-ring-val">' + score + '</div><div class="score-ring-lbl">match</div></div></div>' +
      '<div class="drawer-rec-row"><div class="rec-pill rec-' + rec + '"><i class="ti ' + (rec==='Apply'?'ti-circle-check':rec==='Consider'?'ti-circle-dashed':'ti-circle-x') + '"></i>' + rec + '</div></div>' +
      '<div class="drawer-title">' + escapeHtml(a.actualRole || 'Unknown role') + '</div>' +
      '<div class="drawer-subtitle">' + escapeHtml(a.jobCategory || '') + ' · ' + (FLAGS[jobCountry(job)]||'') + ' ' + escapeHtml(jobCountry(job)) + ' · Analyzed ' + formatDate(job.timestamp) + '</div>' +
    '</div>' +
    '<div class="drawer-body">' +
      '<div class="facts-grid">' +
        factCell('Company', a.company, 'ti-building') +
        factCell('Location', a.location, 'ti-map-pin') +
        factCell('Experience', a.experienceRequired, 'ti-briefcase') +
        factCell('Posted', postedLabel(job.postedDate).replace(/^Posted /,''), 'ti-calendar') +
        factCell('Visa / sponsorship', a.visaSponsorship, 'ti-plane') +
        (a.wetLabScore ? factCell('Bench / Bioprocess Match', a.wetLabScore + '%', 'ti-flask') : '') +
        (a.computationalScore ? factCell('In Silico / NGS Match', a.computationalScore + '%', 'ti-dna') : '') +
      '</div>' +
      tailorCard(job) +
      (a.companySignal ? '<div class="signal-row"><div class="signal-row-icon"><i class="ti ti-shield-check"></i></div><div class="signal-row-body">' +
        '<div class="signal-row-label">Company signal</div>' +
        '<div class="signal-row-value"><span class="signal-badge signal-' + (a.companySignal.includes('Top')?'Top':a.companySignal.includes('Good')?'Good':a.companySignal.includes('Caution')?'Caution':'Unknown') + '">' + escapeHtml(a.companySignal) + '</span></div>' +
        (a.companyNote ? '<div class="signal-row-note">' + escapeHtml(a.companyNote) + '</div>' : '') +
      '</div></div>' : '') +
      (a.reasoning ? sec('Why this score','ti-message-circle-2','<div class="section-body">' + escapeHtml(a.reasoning) + '</div>') : '') +
      ((a.strengths||[]).length ? sec('Strengths matched','ti-circle-check','<div class="tag-list">' + a.strengths.map(s=>'<span class="tag tag-s"><i class="ti ti-check"></i>' + escapeHtml(s) + '</span>').join('') + '</div>') : '') +
      ((a.gaps||[]).length ? sec('Gaps to address','ti-alert-triangle','<div class="tag-list">' + a.gaps.map(g=>'<span class="tag tag-g"><i class="ti ti-alert-circle"></i>' + escapeHtml(g) + '</span>').join('') + '</div>') : '') +
      (a.careerGrowth ? sec('Career growth','ti-trending-up','<div class="section-body">' + escapeHtml(a.careerGrowth) + '</div>') : '') +
      ((a.applicationTips||[]).length ? sec('Application tips','ti-bulb','<div class="tip-list">' + a.applicationTips.map((t,i)=>'<div class="tip"><div class="tip-num">' + (i+1) + '</div><div class="tip-text">' + escapeHtml(t) + '</div></div>').join('') + '</div>') : '') +
      ((a.actionChecklist||[]).length ? sec('Action checklist','ti-list-check','<div class="checklist">' + a.actionChecklist.map((item,i)=>{const done=!!checkState[i];return '<div class="check-item' + (done?' done':'') + '" onclick="toggleCheck(\'' + job.id + '\', ' + i + ')"><div class="check-box"><i class="ti ti-check"></i></div><div class="check-text">' + escapeHtml(item) + '</div></div>';}).join('') + '</div>') : '') +
      sec('Personal notes','ti-notes','<textarea class="notes-textarea" id="notes-area" placeholder="Add your thoughts, contacts, or next steps…" oninput="saveNotes(\'' + job.id + '\', this.value)">' + escapeHtml(job.notes || '') + '</textarea><div class="notes-status" id="notes-status"></div>') +
    '</div>' +
    '<div class="drawer-footer">' +
      (job.url ? '<button class="btn-primary" onclick="window.open(\'' + escapeHtml(applyUrl(job)) + '\', \'_blank\')"><i class="ti ti-external-link"></i>' + applyLabel(job) + '</button>' : '<div class="btn-primary" style="opacity:0.5;cursor:default">No URL saved</div>') +
      '<button class="btn-danger" onclick="deleteJob(\'' + job.id + '\')"><i class="ti ti-trash"></i></button>' +
    '</div>';
  document.getElementById('drawer-bg').classList.add('open');
}
function factCell(label, value, icon) {
  const empty = !value || value === '';
  return '<div class="fact"><div class="fact-label"><i class="ti ' + icon + '"></i>' + label + '</div><div class="fact-value' + (empty?' empty':'') + '">' + (empty ? 'Not specified' : escapeHtml(value)) + '</div></div>';
}
function sec(title, icon, body) {
  return '<div class="section-d"><div class="section-d-title"><i class="ti ' + icon + '"></i>' + title + '</div>' + body + '</div>';
}
function closeDrawer(){ document.getElementById('drawer-bg').classList.remove('open'); currentDetailId = null; }

let notesTimer;
function saveNotes(id, value) {
  document.getElementById('notes-status').textContent = 'Saving…';
  clearTimeout(notesTimer);
  notesTimer = setTimeout(async () => {
    await updateJob(id, { notes: value });
    document.getElementById('notes-status').textContent = 'Saved';
    setTimeout(() => { const el = document.getElementById('notes-status'); if (el) el.textContent = ''; }, 1500);
  }, 600);
}
async function updateStatus(id, status) {
  await updateJob(id, { status });
  const j = allJobs.find(j => j.id === id);
  if (j) j.status = status;
  if (route==='home') renderHome();
}
async function toggleCheck(jobId, idx) {
  const j = allJobs.find(j => j.id === jobId);
  if (!j) return;
  const state = j.checklistState || {};
  state[idx] = !state[idx];
  j.checklistState = state;
  await updateJob(jobId, { checklistState: state });
  if (currentDetailId === jobId) openDetail(jobId);
}
async function updateJob(id, updates) {
  try {
    await fetch('/api/jobs/' + id + '?key=' + encodeURIComponent(KEY), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    const j = allJobs.find(j => j.id === id);
    if (j) Object.assign(j, updates);
  } catch (e) { console.error('Update failed:', e); }
}
async function deleteJob(id) {
  if (!confirm('Delete this job entry permanently?')) return;
  try {
    await fetch('/api/jobs/' + id + '?key=' + encodeURIComponent(KEY), { method: 'DELETE' });
    allJobs = allJobs.filter(j => j.id !== id);
    closeDrawer();
    render();
  } catch (e) { alert('Failed to delete: ' + e.message); }
}

async function dedupJobs() {
  if (!confirm('Remove duplicate job entries? Keeps the newest copy of each posting and deletes the rest. This cannot be undone.')) return;
  try {
    const res = await fetch('/api/dedup?key=' + encodeURIComponent(KEY), { method: 'POST' });
    const data = await res.json();
    if (data.error) { alert('Dedup failed: ' + data.error); return; }
    alert('Removed ' + data.deleted + ' duplicate entr' + (data.deleted === 1 ? 'y' : 'ies') + ' (scanned ' + data.scanned + ').');
    await load();
  } catch (e) { alert('Dedup failed: ' + e.message); }
}

function exportCSV() {
  if (allJobs.length === 0) { alert('No jobs to export'); return; }
  const rows = [['Date Analyzed','Posted','Section','Country','Role','Company','Location','Experience','Type','Visa','Score','Recommendation','Status','Company Signal','URL']];
  allJobs.forEach(j => {
    const a = j.analysis || {};
    rows.push([formatDate(j.timestamp), (postedLabel(j.postedDate)||'').replace(/^Posted /,''), sectionOf(j), jobCountry(j), a.actualRole||'', a.company||'', a.location||'', a.experienceRequired||'', a.employmentType||'', a.visaSponsorship||'', a.matchScore||'', a.recommendation||'', j.status||'new', a.companySignal||'', j.url||'']);
  });
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'jobs-' + new Date().toISOString().slice(0,10) + '.csv';
  link.click();
}

function postedLabel(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return 'Posted recently';
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Posted today';
  if (days === 1) return 'Posted 1d ago';
  if (days < 30) return 'Posted ' + days + 'd ago';
  const d = new Date(t);
  return 'Posted ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts); const now = Date.now(); const diff = now - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function isAdzunaUrl(url) {
  return !!url && /adzuna\./i.test(url);
}
function applyUrl(job) {
  if (!job || !job.url) return '';
  if (!isAdzunaUrl(job.url)) return job.url;
  const a = job.analysis || {};
  const role = a.actualRole || job.pageTitle || '';
  let company = a.company || '';
  if (!company || /^adzuna/i.test(company)) company = '';
  const parts = [role, company, 'jobs'].filter(Boolean);
  const query = parts.join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(query) + '+site%3Alinkedin.com+OR+site%3Aindeed.com';
}
function applyLabel(job) {
  return isAdzunaUrl(job && job.url) ? 'Find this job on LinkedIn' : 'Open & apply on original page';
}
function applyTooltip(job) {
  return isAdzunaUrl(job && job.url) ? 'Search LinkedIn / Indeed for the original posting (Adzuna blocks cross-region viewing)' : 'Open original job page';
}

function tailorCard(job) {
  const isDoc = isPhd(job);
  return '<div class="tailor-card">' +
    '<div class="tailor-head">' +
      '<div class="tailor-icon"><i class="ti ti-sparkles"></i></div>' +
      '<div>' +
        '<div class="tailor-title">Tailor Application Kit & Resume Studio</div>' +
        '<div class="tailor-sub">' + (isDoc ? '1-click academic Word CV, cover letter, PI networking message, and AI prompts.' : '1-click tailored Word (.docx) resume, targeted cover letter, hiring manager InMail, and AI prompt.') + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="tailor-btns">' +
      '<button class="btn-tailor btn-tailor-primary" onclick="downloadModalDocx(\'' + job.id + '\')"><i class="ti ti-download"></i> Download Word (.docx)</button>' +
      '<button class="btn-tailor btn-tailor-secondary" onclick="showTailoredResume(\'' + job.id + '\')"><i class="ti ti-file-text"></i> View Draft</button>' +
      '<button class="btn-tailor btn-tailor-secondary" onclick="downloadCoverLetterDocx(\'' + job.id + '\')"><i class="ti ti-mail-forward"></i> Cover Letter (.docx)</button>' +
      '<button class="btn-tailor btn-tailor-secondary" onclick="copyColdOutreach(\'' + job.id + '\')"><i class="ti ti-brand-linkedin"></i> Copy InMail</button>' +
      '<button class="btn-tailor btn-tailor-secondary" onclick="openHiringManagerSearch(\'' + job.id + '\')"><i class="ti ti-search"></i> ' + (isDoc ? 'Find Lab PI' : 'Find Hiring Manager') + '</button>' +
      '<button class="btn-tailor btn-tailor-secondary" onclick="copyResumePrompt(\'' + job.id + '\')"><i class="ti ti-robot"></i> AI Prompt</button>' +
    '</div>' +
  '</div>';
}

function showTailoredResume(id) {
  currentDetailId = id;
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  const a = job.analysis || {};
  document.getElementById('resume-modal-job-title').textContent = (a.actualRole || 'Tailored Document') + (isPhd(job) ? ' (Academic CV)' : ' (ATS Resume)');
  document.getElementById('resume-modal-company').textContent = (a.company || 'Target Organization') + (a.location ? ' · ' + a.location : '');
  const content = buildTailoredResumeText(job);
  document.getElementById('resume-text-area').value = content;
  document.getElementById('resume-modal-bg').classList.add('open');
}

function closeResumeModal() {
  const bg = document.getElementById('resume-modal-bg');
  if (bg) bg.classList.remove('open');
}

function copyModalResume() {
  const text = document.getElementById('resume-text-area').value;
  copyToClipboard(text, 'Copied tailored resume to clipboard!');
}

function downloadModalResume() {
  const job = allJobs.find(j => j.id === currentDetailId);
  const a = (job && job.analysis) || {};
  const cleanRole = ((a.actualRole || 'Resume') + '-' + (a.company || 'Biotech')).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = 'Sudakshina_Deb_' + cleanRole + '.md';
  const text = document.getElementById('resume-text-area').value;
  downloadMarkdown(filename, text);
}

function saveBlobFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function downloadModalDocx(jobId) {
  const id = jobId || currentDetailId;
  const job = allJobs.find(j => j.id === id);
  if (!job) {
    showToast('Please select a job first.');
    return;
  }
  const a = job.analysis || {};
  const isDoc = isPhd(job);
  const company = a.company || 'Biotech';
  const role = a.actualRole || 'Scientist';
  const cleanComp = company.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanRole = role.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = 'Sudakshina_Deb_Resume_' + cleanComp + '_' + cleanRole + '.docx';

  if (typeof window.docx === 'undefined') {
    showToast('Preparing document... downloading Markdown version');
    downloadModalResume();
    return;
  }

  showToast('Generating tailored Word resume for ' + company + '…');

  try {
    const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = window.docx;
    const children = [];

    // Header Name
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({ text: "SUDAKSHINA DEB", bold: true, size: 34, font: "Calibri", color: "1E3A8A" })
      ]
    }));

    // Headline
    const subTitle = isDoc
      ? "Doctoral Researcher & Scientist | Molecular Biology & Protein Sciences"
      : (/bioinform|computational|ngs|genom/i.test(role + ' ' + (a.jobCategory||''))
          ? "Bioinformatics & Downstream Protein Scientist"
          : "Senior Scientist — Downstream Protein Sciences & Bioprocess Development");

    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: subTitle, bold: true, size: 22, font: "Calibri", color: "374151" })
      ]
    }));

    // Contact
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        new TextRun({ text: "Bengaluru, India  |  +91 97486 44342  |  sudakshinadeb100@gmail.com  |  linkedin.com/in/sudakshina-deb-041499120", size: 19, font: "Calibri", color: "4B5563" })
      ]
    }));

    function addSection(title) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 80 },
        border: {
          bottom: { color: "1E3A8A", space: 3, style: BorderStyle.SINGLE, size: 12 }
        },
        children: [
          new TextRun({ text: title.toUpperCase(), bold: true, size: 21, font: "Calibri", color: "1E3A8A" })
        ]
      }));
    }

    function addBullet(boldPrefix, text) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { before: 30, after: 40 },
        children: [
          new TextRun({ text: boldPrefix ? boldPrefix + " " : "", bold: !!boldPrefix, size: 20, font: "Calibri", color: "1F2937" }),
          new TextRun({ text: text, size: 20, font: "Calibri", color: "374151" })
        ]
      }));
    }

    // Professional Summary
    addSection("Professional Summary");
    const summaryText = isDoc
      ? ('Accomplished life sciences researcher with 3.8 years of industrial research experience at Syngene International Ltd. (Biocon Group) and an M.Tech in Biotechnology & Biochemical Engineering from IIT Kharagpur (CGPA 8.78). Hands-on expertise in recombinant protein expression, AKTA chromatography purification (affinity, IEX, SEC, HIC), biophysical characterization (SEC-HPLC, SDS-PAGE), and in silico bioinformatics (Python, R, NGS analysis). Dedicated to applying advanced bioprocess and structural biology competencies to doctoral research in ' + role + ' at ' + company + '.')
      : 'Accomplished Senior Scientist with 3.8 years of biopharmaceutical industry experience at Syngene International Ltd. specializing in downstream protein purification, bioprocess development, and analytical characterization for monoclonal antibodies (mAbs), bispecifics, and recombinant therapeutics. Expert in AKTA Avant/Pure systems, Tangential Flow Filtration (TFF), and SEC-HPLC purity profiling under ALCOA++ GDP/GLP compliance. Recipient of Syngene SPOT Award for rapid troubleshooting and high-recovery delivery. Holds M.Tech in Biotechnology from IIT Kharagpur with computational skills in Python and R.';

    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: summaryText, size: 20, font: "Calibri", color: "374151" })
      ]
    }));

    // Core Competencies
    addSection("Core Technical Competencies");
    addBullet("Preparative Chromatography & Downstream:", "AKTA Pure, AKTA Avant, UNICORN software; Affinity (Protein A/G, Ni-NTA His-tag), Ion Exchange (CEX, AEX), Size Exclusion (SEC), Hydrophobic Interaction (HIC).");
    addBullet("Bioprocess & Membrane Technologies:", "Tangential Flow Filtration (TFF, Pellicon cassettes), Centricon ultrafiltration/diafiltration (UF/DF), dialysis, buffer formulation, scale-down modeling.");
    addBullet("Analytical Characterization & QC:", "SEC-HPLC (monomer purity & aggregate profiling), SDS-PAGE (reducing/non-reducing), Western Blotting, Endosafe PTS (kinetic LAL endotoxin assays), UV-Vis spectrometry.");
    addBullet("Biotherapeutic Modalities:", "Monoclonal antibodies (mAbs), Bispecific antibodies (bsAbs), Fc-fusion proteins, His-tagged antigens, therapeutic enzymes.");
    addBullet("Computational Biology & Data Science:", "Python (Biopython, pandas, NumPy), R, Linux/Bash, NGS workflows, QIIME2 amplicon pipeline, AlphaFold2 structural modeling, PyMOL.");
    addBullet("Compliance & Documentation:", "ALCOA++ data integrity standards, Standard Operating Procedures (SOPs), Batch Manufacturing Records (BMRs), GLP/GMP laboratory environment.");

    // Professional Experience
    addSection("Professional Experience");
    children.push(new Paragraph({
      spacing: { before: 80, after: 30 },
      children: [
        new TextRun({ text: "SYNGENE INTERNATIONAL LIMITED (BIOCON GROUP)", bold: true, size: 21, font: "Calibri", color: "111827" }),
        new TextRun({ text: "  |  Bengaluru, India", size: 19, font: "Calibri", color: "6B7280" })
      ]
    }));
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: "Research Associate II — Downstream Protein Sciences & Discovery Biology", italics: true, bold: true, size: 20, font: "Calibri", color: "374151" }),
        new TextRun({ text: "  |  Sep 2022 – Present", size: 19, font: "Calibri", color: "6B7280" })
      ]
    }));

    addBullet("Biotherapeutic Purification Workflows:", "Spearheaded downstream purification and recovery optimization for 30+ recombinant therapeutic projects, including mAbs, bispecific antibodies, and complex fusion constructs using AKTA systems.");
    addBullet("Chromatography Method Development:", "Developed, scaled, and standardized multi-step chromatographic workflows across Protein A, Ni-NTA, CEX, AEX, and SEC, consistently achieving >95% monomer purity and >85% yield recovery.");
    addBullet("UF/DF & TFF Parameter Optimization:", "Established Tangential Flow Filtration (TFF) and ultrafiltration/diafiltration parameters, cutting cycle time by 25% while sustaining high product stability.");
    addBullet("Analytical Release Testing:", "Conducted routine release and purity profiling using SEC-HPLC, SDS-PAGE (reducing/non-reducing), Western blot validation, and kinetic LAL endotoxin quantification.");
    addBullet("ALCOA++ Regulatory Adherence:", "Championed data integrity compliance; authored Standard Operating Procedures (SOPs) and comprehensive Batch Manufacturing Records (BMRs).");
    addBullet("Syngene SPOT Award:", "Awarded SPOT Award (Feb 2023) for outstanding technical troubleshooting and on-time delivery of critical client biotherapeutic batches under tight deadlines.");

    // Education
    addSection("Education & Credentials");
    children.push(new Paragraph({
      spacing: { before: 80, after: 20 },
      children: [
        new TextRun({ text: "INDIAN INSTITUTE OF TECHNOLOGY (IIT) KHARAGPUR", bold: true, size: 21, font: "Calibri", color: "111827" }),
        new TextRun({ text: "  |  2020 – 2022", size: 19, font: "Calibri", color: "6B7280" })
      ]
    }));
    children.push(new Paragraph({
      spacing: { after: 50 },
      children: [
        new TextRun({ text: "Master of Technology (M.Tech) in Biotechnology & Biochemical Engineering", italics: true, size: 20, font: "Calibri", color: "374151" }),
        new TextRun({ text: "  |  CGPA: 8.78 / 10.0", bold: true, size: 20, font: "Calibri", color: "1E3A8A" })
      ]
    }));

    children.push(new Paragraph({
      spacing: { before: 60, after: 20 },
      children: [
        new TextRun({ text: "HERITAGE INSTITUTE OF TECHNOLOGY", bold: true, size: 21, font: "Calibri", color: "111827" }),
        new TextRun({ text: "  |  2016 – 2020", size: 19, font: "Calibri", color: "6B7280" })
      ]
    }));
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "Bachelor of Technology (B.Tech) in Biotechnology", italics: true, size: 20, font: "Calibri", color: "374151" }),
        new TextRun({ text: "  |  DGPA: 8.84 / 10.0", bold: true, size: 20, font: "Calibri", color: "1E3A8A" })
      ]
    }));

    // Honors
    addSection("Honors & Key Achievements");
    addBullet("Syngene SPOT Award (2023):", "Conferred for exemplary commitment and high-efficiency protein purification delivery.");
    addBullet("Graduate Aptitude Test in Engineering (GATE):", "Qualified in Biotechnology with top percentile nationwide.");
    addBullet("Academic Excellence Honors:", "Graduated in top 5% of class at IIT Kharagpur.");

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 864, right: 864 }
          }
        },
        children
      }]
    });

    const blob = await Packer.toBlob(doc);
    saveBlobFile(filename, blob);
    showToast('Downloaded Word Resume: ' + filename);
  } catch (err) {
    console.error('Docx generation error:', err);
    showToast('Docx error; downloading Markdown version...');
    downloadModalResume();
  }
}

async function downloadCoverLetterDocx(jobId) {
  const id = jobId || currentDetailId;
  const job = allJobs.find(j => j.id === id);
  if (!job) {
    showToast('Please select a job first.');
    return;
  }
  const a = job.analysis || {};
  const isDoc = isPhd(job);
  const company = a.company || 'Target Organization';
  const role = a.actualRole || 'Scientist';
  const loc = a.location || '';
  const cleanComp = company.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = 'Sudakshina_Deb_Cover_Letter_' + cleanComp + '.docx';

  if (typeof window.docx === 'undefined') {
    showToast('Word generator loading... Copying Cover Letter Prompt');
    copyCoverLetterPrompt(id);
    return;
  }

  showToast('Generating Cover Letter for ' + company + '…');

  try {
    const { Document, Packer, Paragraph, TextRun, AlignmentType } = window.docx;
    const children = [];

    // Header Name
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 50 },
      children: [
        new TextRun({ text: "SUDAKSHINA DEB", bold: true, size: 32, font: "Calibri", color: "1E3A8A" })
      ]
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [
        new TextRun({ text: "Bengaluru, India  |  +91 97486 44342  |  sudakshinadeb100@gmail.com  |  linkedin.com/in/sudakshina-deb-041499120", size: 19, font: "Calibri", color: "4B5563" })
      ]
    }));

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    children.push(new Paragraph({
      spacing: { before: 80, after: 100 },
      children: [new TextRun({ text: today, size: 21, font: "Calibri" })]
    }));

    children.push(new Paragraph({
      spacing: { after: 30 },
      children: [new TextRun({ text: "To:", bold: true, size: 21, font: "Calibri" })]
    }));
    children.push(new Paragraph({
      spacing: { after: 30 },
      children: [new TextRun({ text: isDoc ? "Doctoral Selection Committee / Principal Investigator" : "Hiring Manager & Biologics Selection Team", size: 21, font: "Calibri" })]
    }));
    children.push(new Paragraph({
      spacing: { after: 30 },
      children: [new TextRun({ text: company, bold: true, size: 21, font: "Calibri" })]
    }));
    if (loc) {
      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: loc, size: 21, font: "Calibri", color: "6B7280" })]
      }));
    }

    children.push(new Paragraph({
      spacing: { before: 80, after: 140 },
      children: [
        new TextRun({ text: "Subject: Application for " + role + " (Sudakshina Deb - M.Tech IIT Kharagpur)", bold: true, size: 21, font: "Calibri", color: "1E3A8A" })
      ]
    }));

    const p1 = isDoc
      ? ('Dear Professor / Selection Committee,\n\nI am writing to formally submit my application for the ' + role + ' position within ' + company + '. With an M.Tech in Biotechnology & Biochemical Engineering from IIT Kharagpur (CGPA: 8.78) and 3.8 years of industrial bioprocess research at Syngene International Ltd. (Biocon Group), I have developed a rigorous foundation in recombinant protein expression, multi-modal chromatographic purification (AKTA systems), and bioanalytical characterization. I am eager to dedicate my technical rigor and research passion to your group\'s scientific objectives.')
      : ('Dear Hiring Team,\n\nI am writing to express my strong interest in the ' + role + ' opportunity at ' + company + '. Having spent the past 3.8 years as a Research Associate II in Downstream Protein Sciences at Syngene International Ltd. (Biocon Group) alongside completing my M.Tech in Biotechnology from IIT Kharagpur (CGPA: 8.78), I have accumulated comprehensive hands-on expertise in developing, scaling, and validating downstream purification protocols for complex biotherapeutics.');

    const p2 = 'Throughout my tenure at Syngene, I have spearheaded the purification of over 30+ recombinant therapeutic projects—including monoclonal antibodies (mAbs), bispecifics, and fusion constructs—using AKTA Pure and Avant platforms. My day-to-day focus encompasses developing multi-step chromatography strategies (Affinity, CEX, AEX, HIC, SEC), establishing Tangential Flow Filtration (TFF) parameters, and executing release characterization via SEC-HPLC and SDS-PAGE under ALCOA++ compliance. Recognizing my ability to troubleshoot challenging aggregation barriers and deliver high-yield batches under urgent timelines, Syngene conferred upon me the SPOT Award.';

    const p3 = 'Beyond wet-lab execution, I bring a multidisciplinary edge with proficiency in Python, R, and NGS pipelines, enabling data automation and in silico insights. I admire ' + company + '\'s dedication to innovation in biotherapeutics and scientific discovery, and I am confident that my proven bioprocess expertise, analytical rigor, and collaborative spirit will allow me to make immediate contributions to your team.';

    const p4 = 'Thank you for your time and consideration. I welcome the opportunity to discuss my qualifications and how my background aligns with ' + company + '\'s goals in greater detail.';

    [p1, p2, p3, p4].forEach(text => {
      children.push(new Paragraph({
        spacing: { before: 60, after: 120 },
        children: [new TextRun({ text, size: 21, font: "Calibri", color: "1F2937" })]
      }));
    });

    children.push(new Paragraph({
      spacing: { before: 100, after: 40 },
      children: [new TextRun({ text: "Sincerely,", size: 21, font: "Calibri" })]
    }));
    children.push(new Paragraph({
      spacing: { after: 30 },
      children: [new TextRun({ text: "Sudakshina Deb", bold: true, size: 22, font: "Calibri", color: "1E3A8A" })]
    }));
    children.push(new Paragraph({
      spacing: { after: 30 },
      children: [new TextRun({ text: "+91 97486 44342  |  sudakshinadeb100@gmail.com", size: 19, font: "Calibri", color: "6B7280" })]
    }));

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 }
          }
        },
        children
      }]
    });

    const blob = await Packer.toBlob(doc);
    saveBlobFile(filename, blob);
    showToast('Downloaded Word Cover Letter: ' + filename);
  } catch (err) {
    console.error('Cover letter generation error:', err);
    showToast('Cover letter error; copying prompt instead.');
    copyCoverLetterPrompt(id);
  }
}

function copyColdOutreach(jobId) {
  const id = jobId || currentDetailId;
  const job = allJobs.find(j => j.id === id);
  if (!job) {
    showToast('Please select a job first.');
    return;
  }
  const a = job.analysis || {};
  const company = a.company || 'your organization';
  const role = a.actualRole || 'the open role';
  const isDoc = isPhd(job);

  let message = '';
  if (isDoc) {
    message = 'Subject: Inquiry regarding Doctoral / Research Opportunity at ' + company + ' - Sudakshina Deb (M.Tech IIT Kharagpur)\n\n' +
      'Dear Professor / Research Team,\n\n' +
      'I am writing to express my strong interest in doctoral / research opportunities within your group at ' + company + ', particularly concerning ' + role + '.\n\n' +
      'I hold an M.Tech in Biotechnology & Biochemical Engineering from IIT Kharagpur (CGPA: 8.78) and have 3.8 years of industrial research experience at Syngene International (Biocon Group), specializing in downstream protein purification (AKTA systems), biophysical characterization, and molecular analysis. My background combines rigorous wet-lab protein chemistry with computational and NGS data analysis.\n\n' +
      'I would be eager to discuss how my research foundation and experimental rigor could contribute to your laboratory\'s upcoming projects. My CV and research summary are available for your review.\n\n' +
      'Thank you for your time and consideration.\n\n' +
      'Best regards,\nSudakshina Deb\nBengaluru, India | +91 97486 44342 | sudakshinadeb100@gmail.com\nlinkedin.com/in/sudakshina-deb-041499120';
  } else {
    message = 'Subject: Inquiry regarding ' + role + ' - Sudakshina Deb (M.Tech IIT Kharagpur | 3.8 yrs Downstream Bioprocess)\n\n' +
      'Dear ' + company + ' Hiring Team,\n\n' +
      'I noticed the open ' + role + ' position at ' + company + ' and wanted to reach out directly. With 3.8 years of downstream bioprocess development experience at Syngene International (Biocon Group) and an M.Tech from IIT Kharagpur (CGPA 8.78), my background aligns directly with your technical requirements.\n\n' +
      'At Syngene, I specialize in preparative protein purification (AKTA Avant/Pure, IEX, HIC, Affinity, SEC) and analytical characterization (SEC-HPLC, SDS-PAGE) for monoclonal and bispecific antibodies, earning a SPOT Award for delivering critical biotherapeutic milestones under compressed timelines.\n\n' +
      'I would welcome the opportunity to connect for a brief 10-minute conversation to discuss how my bioprocess background can support ' + company + '\'s pipeline.\n\n' +
      'Sincerely,\nSudakshina Deb\n+91 97486 44342 | sudakshinadeb100@gmail.com\nlinkedin.com/in/sudakshina-deb-041499120';
  }

  copyToClipboard(message, 'Copied Cold InMail / Outreach message to clipboard!');
}

function openHiringManagerSearch(jobId) {
  const id = jobId || currentDetailId;
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  const a = job.analysis || {};
  const company = a.company || '';
  const isDoc = isPhd(job);

  let searchUrl = '';
  if (isDoc) {
    const q = company + ' ' + (a.actualRole || 'protein biology') + ' Professor Principal Investigator';
    searchUrl = 'https://scholar.google.com/scholar?q=' + encodeURIComponent(q);
  } else {
    const q = 'site:linkedin.com/in "' + company + '" ("Head of Downstream" OR "Discovery Biology" OR "Director Biologics" OR "Bioprocess" OR "Talent Acquisition")';
    searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(q);
  }
  window.open(searchUrl, '_blank');
}

function copyResumePrompt(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  const prompt = buildResumePrompt(job);
  copyToClipboard(prompt, 'Copied AI Resume Prompt! Paste into Claude, ChatGPT, or Gemini.');
}

function copyCoverLetterPrompt(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  const prompt = buildCoverLetterPrompt(job);
  copyToClipboard(prompt, 'Copied Cover Letter / Statement Prompt to clipboard!');
}

function copyToClipboard(text, successMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg || 'Copied to clipboard!');
    }).catch(() => {
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(successMsg || 'Copied to clipboard!');
  } catch (e) {
    showToast('Could not copy automatically. Please copy manually.');
  }
}

function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded ' + filename);
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = '<i class="ti ti-check"></i> ' + escapeHtml(msg);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3000);
}

function buildTailoredResumeText(job) {
  const a = job.analysis || {};
  const isDoc = isPhd(job);
  const role = a.actualRole || 'Biotech Scientist';
  const company = a.company || 'Biopharmaceutical Organization';
  const loc = a.location || 'Bangalore, India';
  const strengths = a.strengths || [];

  if (isDoc) {
    return [
      '# SUDAKSHINA DEB',
      '**Academic Curriculum Vitae & Doctoral Research Dossier**',
      'Bangalore, Karnataka, India | sudakshinadeb@gmail.com | linkedin.com/in/sudakshina-deb',
      '',
      '---',
      '',
      '### PROPOSED DOCTORAL CANDIDACY',
      '**Target Program / Group:** ' + role + ' — ' + company + (loc ? ' (' + loc + ')' : ''),
      '**Core Research Focus:** Macromolecular Downstream Purification, Structural Bioprocessing & Computational Genomics',
      '',
      '### ACADEMIC & RESEARCH PROFILE',
      'Accomplished bioprocess scientist with 4 years of rigorous industrial R&D experience in downstream protein sciences at Syngene International Ltd. combined with a solid academic foundation in Zoology (M.Sc. First Class Honours, NEHU) and Bioinformatics/Genomics (PG Diploma, Bversity). Hands-on mastery of AKTA preparative chromatography, therapeutic monoclonal antibodies (mAbs), bispecifics, and high-resolution analytical characterization (SEC-HPLC, Western Blot, SDS-PAGE), augmented by computational genomics workflows (QIIME2, Python, AlphaFold2). Highly motivated to undertake doctoral research at ' + company + ', bringing proven experimental bench rigor, experimental design, and multidisciplinary bioinformatic capabilities.',
      '',
      '### EDUCATION & ACADEMIC CREDENTIALS',
      '- **Post Graduate Diploma in Bioinformatics and Applied Genomics** (2022)',
      '  *Bversity, India* — Distinction',
      '  *Focus:* NGS pipelines, Python/R for genomics, structural bioinformatics, molecular docking.',
      '',
      '- **Master of Science (M.Sc.) in Zoology (Honours)** (2018 – 2020)',
      '  *North-Eastern Hill University (NEHU), Shillong, Meghalaya* — First Class Honours',
      '  *Focus:* Molecular biology, genetics, cell biology, biochemistry, biostatistics.',
      '',
      '- **Bachelor of Science (B.Sc.) in Zoology (Honours)**',
      '  *First Class*, Core coursework in Cellular Biology, Physiology, and Genetics.',
      '',
      '### RESEARCH & PROFESSIONAL EXPERIENCE',
      '**Syngene International Limited** | Bangalore, India',
      '*Senior Scientist — Downstream Protein Sciences & Discovery Biology* (2022 – Present)',
      '*(Promoted from Senior Research Associate)*',
      '- Directed downstream chromatography purification and process optimization for 40+ recombinant projects, including monoclonal antibodies (mAbs), complex bispecific constructs, and His-tagged target proteins.',
      '- Designed and optimized multi-step purification strategies utilizing AKTA Pure and AKTA Avant systems across Affinity (Protein A/G, Ni-NTA), CEX, AEX, and SEC, consistently achieving >95% monomer purity.',
      '- Engineered Tangential Flow Filtration (TFF) and ultrafiltration/diafiltration (UF/DF) workflows, accelerating buffer exchange turnaround by 25% while maintaining quantitative yield recovery (>90%).',
      '- Performed analytical characterization including SEC-HPLC (purity and aggregate quantification), SDS-PAGE (reducing/non-reducing), Western Blotting, and Endosafe kinetic LAL endotoxin testing.',
      '- Maintained strict data integrity standards under ALCOA++ guidelines; authored Batch Manufacturing Records (BMR) and standard operating procedures (SOPs).',
      '- Awarded the Syngene SPOT Award (Feb 2023) for downstream troubleshooting and timely delivery of high-purity bispecific antibody batches.',
      '',
      '**Rajiv Gandhi Centre for Biotechnology (RGCB) / Academic Collaboration**',
      '*Graduate Research Fellow — Neurodevelopmental Disorder Genetics*',
      '- Investigated genetic variants and molecular markers associated with Fragile X syndrome and intellectual developmental disabilities.',
      '- Executed genomic DNA extraction, PCR amplifications, primer design, gel electrophoresis, and Sanger sequencing analyses.',
      '- Co-authored 1 peer-reviewed research publication in molecular genetics.',
      '',
      '### TECHNICAL & SCIENTIFIC COMPETENCIES',
      '- **Preparative Chromatography & Equipment:** AKTA pure, AKTA avant, UNICORN software, Protein A, Protein G, Ni-NTA, CEX, AEX, HIC, SEC.',
      '- **Bioprocess & Membrane Technologies:** Tangential Flow Filtration (TFF, Pellicon cassettes), Centricon UF/DF, dialysis, buffer formulation.',
      '- **Analytical Characterization:** SEC-HPLC (aggregation & purity profiling), SDS-PAGE, Western Blot, Endosafe PTS (LAL endotoxin assays), UV-Vis spectrometry.',
      '- **Computational Biology & In Silico:** Python (Biopython, Pandas, NumPy), R, Linux/Bash, NGS analysis, QIIME2 microbiome pipeline (DADA2, SILVA), AlphaFold2, PyMOL.',
      '- **Quality & Data Governance:** ALCOA++ compliance, BMR authoring, GLP/GMP laboratory documentation.',
      '',
      '### PUBLICATIONS, AWARDS & HACKATHONS',
      '- **Peer-Reviewed Journal Publication:** Co-author on genetic investigation of neurodevelopmental disorders (RGCB collaboration).',
      '- **Syngene SPOT Award (Feb 2023):** Recognized for exceptional troubleshooting and downstream recovery optimization.',
      '- **IBAB Hackathon Participant:** Computational antibody CDR engineering & binding site prediction.'
    ].join('\n');
  }

  const isComp = /bioinform|computational|ngs|data|genom/i.test(role + ' ' + (a.jobCategory||''));
  const targetHeadline = isComp
    ? 'Bioinformatics & Downstream Protein Scientist'
    : 'Senior Scientist — Downstream Protein Sciences & Bioprocess Development';

  return [
    '# SUDAKSHINA DEB',
    '**' + targetHeadline + '**',
    'Bangalore, Karnataka, India | sudakshinadeb@gmail.com | linkedin.com/in/sudakshina-deb',
    '',
    '---',
    '',
    '### TARGET POSITION',
    '**' + role + '** | ' + company + (loc ? ' (' + loc + ')' : ''),
    (strengths.length ? '*Matched Core Competencies: ' + strengths.slice(0, 3).join(' · ') + '*' : ''),
    '',
    '### PROFESSIONAL SUMMARY',
    'Accomplished Life Sciences Senior Scientist with 4 years of biopharmaceutical industry experience at Syngene International Ltd. specializing in downstream protein purification, bioprocess development, and analytical characterization. Hands-on expert in AKTA chromatography (Protein A, Ni-NTA, IEX, SEC, HIC), Tangential Flow Filtration (TFF), and SEC-HPLC purity profiling for mAbs, bispecifics, and recombinant proteins. Combines robust wet-lab bioprocess rigor with computational proficiency in Python, R, QIIME2, and AlphaFold2. Proven record of delivering high-recovery, low-endotoxin batches under ALCOA++ standards; recipient of Syngene SPOT Award.',
    '',
    '### CORE COMPETENCIES',
    '- **Downstream Chromatography:** AKTA Pure, AKTA Avant, UNICORN; Affinity (Protein A/G, Ni-NTA His-tag), Ion Exchange (CEX, AEX), Size Exclusion (SEC), Hydrophobic Interaction (HIC).',
    '- **Bioprocess & UF/DF:** Tangential Flow Filtration (TFF, Pellicon cassettes), Centricon ultrafiltration, membrane dialysis, buffer formulation & optimization.',
    '- **Analytical & Quality Testing:** SEC-HPLC (monomer purity & aggregate quantification), SDS-PAGE (reducing/non-reducing), Western Blot, Endosafe PTS kinetic LAL endotoxin assays, UV-Vis.',
    '- **Biotherapeutic Modalities:** Monoclonal antibodies (mAbs), Bispecific antibodies (bsAbs), Fc-fusion constructs, His-tagged antigens, therapeutic enzymes.',
    '- **Computational & Data Analysis:** Python (Pandas, NumPy, Biopython), R, Linux/Bash, NGS workflows, QIIME2 amplicon pipeline, AlphaFold2 structural modeling, PyMOL.',
    '- **Compliance & Standards:** ALCOA++ data integrity, Batch Manufacturing Records (BMR), Standard Operating Procedures (SOPs), GLP/GMP-aligned R&D.',
    '',
    '### PROFESSIONAL EXPERIENCE',
    '**SYNGENE INTERNATIONAL LIMITED** | Bangalore, India',
    '*Senior Scientist — Downstream Protein Sciences & Discovery Biology* (2022 – Present)',
    '*(Promoted from Senior Research Associate)*',
    '- Spearheaded downstream purification and recovery optimization for 40+ biotherapeutic projects, including mAbs, bispecific antibodies, and complex recombinant proteins.',
    '- Developed, scaled, and standardized multi-step AKTA chromatography workflows across Protein A, Ni-NTA, CEX, AEX, and SEC, consistently attaining >95% monomer purity.',
    '- Established Tangential Flow Filtration (TFF) and ultrafiltration/diafiltration (UF/DF) parameters, cutting cycle time by 25% while sustaining >90% product recovery.',
    '- Conducted routine release testing: SEC-HPLC aggregate analysis, reducing and non-reducing SDS-PAGE, Western blot validation, and Endosafe kinetic LAL endotoxin quantification.',
    '- Championed ALCOA++ data integrity adherence; authored and revised Standard Operating Procedures (SOPs) and comprehensive Batch Manufacturing Records (BMRs).',
    '- Honored with the Syngene SPOT Award (Feb 2023) for rapid downstream troubleshooting and on-time delivery of critical client biotherapeutic batches.',
    '',
    '**RAJIV GANDHI CENTRE FOR BIOTECHNOLOGY (RGCB) / ACADEMIC COLLABORATION**',
    '*Graduate Research Fellow — Molecular Genetics*',
    '- Investigated genetic variants and molecular mechanisms contributing to Fragile X syndrome and intellectual developmental disorders.',
    '- Performed PCR amplifications, primer design, gel electrophoresis, genotyping assays, and Sanger sequencing analyses.',
    '- Co-authored 1 peer-reviewed research publication in molecular genetics.',
    '',
    '### EDUCATION & CREDENTIALS',
    '- **Post Graduate Diploma in Bioinformatics and Applied Genomics** — Bversity (Distinction)',
    '- **Master of Science (M.Sc.) in Zoology (Honours)** — North-Eastern Hill University (NEHU), Shillong (First Class)',
    '- **Bachelor of Science (B.Sc.) in Zoology (Honours)** — First Class',
    '',
    '### AWARDS & HACKATHONS',
    '- **Syngene SPOT Award (Feb 2023):** Recognized for downstream recovery optimization and delivery excellence.',
    '- **IBAB Computational Antibody Hackathon:** In silico CDR engineering and molecular binding site modeling.'
  ].join('\n');
}

function buildResumePrompt(job) {
  const a = job.analysis || {};
  const isDoc = isPhd(job);
  const role = a.actualRole || 'Biotech Scientist';
  const company = a.company || 'Organization';
  const loc = a.location || 'Bangalore, India';
  const exp = a.experienceRequired || 'Not specified';
  const visa = a.visaSponsorship || 'Not specified';
  const score = a.matchScore || 0;
  const strengths = (a.strengths || []).join('; ');
  const gaps = (a.gaps || []).join('; ');
  const tips = (a.applicationTips || []).join('\\n- ');
  const reasoning = a.reasoning || '';

  return 'You are a world-class Biotech & Life Sciences Executive Resume Strategist and ATS Specialist.\\n\\n' +
    'Your goal is to generate a comprehensive, tailored, ATS-compliant Markdown Resume for the following candidate applying for this specific target position.\\n\\n' +
    '==================================================\\n' +
    'TARGET POSITION DETAILS\\n' +
    '==================================================\\n' +
    '- Target Role: ' + role + '\\n' +
    '- Organization / Company: ' + company + '\\n' +
    '- Location: ' + loc + '\\n' +
    '- Role Classification: ' + (isDoc ? 'PhD / Doctoral Research Candidacy' : 'Industry Life Sciences Role') + '\\n' +
    '- Experience Requirement: ' + exp + '\\n' +
    '- Visa / Sponsorship Status: ' + visa + '\\n' +
    '- Current Match Score: ' + score + '/100\\n' +
    '- Matched Strengths: ' + (strengths || 'None specified') + '\\n' +
    '- Identified Gaps to Reframe/Bridge: ' + (gaps || 'None specified') + '\\n' +
    '- Analysis Reasoning: ' + reasoning + '\\n' +
    '- Strategic Application Tips:\\n- ' + (tips || 'Focus on relevant downstream purification and characterization experience.') + '\\n\\n' +
    '==================================================\\n' +
    'CANDIDATE MASTER DOSSIER (SUDAKSHINA DEB)\\n' +
    '==================================================\\n' +
    'Candidate: Sudakshina Deb\\n' +
    'Contact: Bangalore, Karnataka, India | sudakshinadeb@gmail.com | linkedin.com/in/sudakshina-deb\\n\\n' +
    'Current Role:\\n' +
    '- Senior Scientist — Downstream Protein Sciences & Discovery Biology at Syngene International Ltd., Bangalore (~4 years, 2022 – Present). Promoted from Senior Research Associate.\\n' +
    '- Key Achievements:\\n' +
    '  * Handled downstream chromatography and recovery optimization for 40+ recombinant therapeutic projects (monoclonal antibodies/mAbs, bispecific antibodies, fusion proteins, His-tagged antigens).\\n' +
    '  * AKTA Pure and AKTA Avant systems (UNICORN): Affinity (Protein A/G, Ni-NTA), Ion Exchange (CEX, AEX), Size Exclusion (SEC), Hydrophobic Interaction (HIC). Purity >95%.\\n' +
    '  * Tangential Flow Filtration (TFF, Pellicon cassettes), Centricon UF/DF, dialysis; reduced cycle time by 25% while maintaining >90% yield.\\n' +
    '  * Analytical testing: SEC-HPLC (aggregates, monomer purity), SDS-PAGE (reducing & non-reducing), Western Blot, Endosafe PTS kinetic LAL endotoxin testing, UV-Vis.\\n' +
    '  * Compliance: ALCOA++ data integrity, SOP authoring, Batch Manufacturing Records (BMR).\\n' +
    '  * Awards: Syngene SPOT Award (Feb 2023) for yield optimization and client batch delivery.\\n\\n' +
    'Computational & Bioinformatics Toolset:\\n' +
    '- Languages: Python (Biopython, Pandas, NumPy), R, Linux/Bash shell.\\n' +
    '- Genomics: QIIME2 amplicon microbiome pipeline (DADA2, SILVA database), NGS preprocessing.\\n' +
    '- Structural: AlphaFold2 structure prediction, PyMOL visualization, antibody CDR modeling (IBAB Hackathon).\\n\\n' +
    'Academic Research:\\n' +
    '- Graduate Research Fellow (RGCB collaboration): Fragile X syndrome / neurodevelopmental genetics. PCR, Sanger sequencing, genotyping.\\n' +
    '- Publication: Co-authored 1 peer-reviewed research paper in genetics.\\n\\n' +
    'Education:\\n' +
    '- Post Graduate Diploma in Bioinformatics & Applied Genomics — Bversity (Distinction)\\n' +
    '- M.Sc. in Zoology (Honours) — North-Eastern Hill University (NEHU), Shillong (First Class)\\n' +
    '- B.Sc. in Zoology (Honours) — First Class\\n\\n' +
    '==================================================\\n' +
    'INSTRUCTIONS FOR RESUME GENERATION\\n' +
    '==================================================\\n' +
    '1. Craft an ATS-optimized, high-impact resume in clean GitHub-flavored Markdown.\\n' +
    '2. Weave in the key requirements of ' + company + '\\\'s ' + role + ' role naturally.\\n' +
    '3. Feature the matched strengths: ' + strengths + '.\\n' +
    '4. Bridge or reframe any identified gaps (' + gaps + ') using candidate\\\'s transferrable wet-lab, analytical, and bioinformatic skills.\\n' +
    '5. Format with:\\n' +
    '   - Header & Target Role\\n' +
    '   - Tailored Professional Summary / Profile\\n' +
    '   - Core Competency Matrix\\n' +
    '   - Professional Experience with high-impact STAR bullet points (Action + Metric + Result)\\n' +
    '   - Academic Research & Dissertations\\n' +
    '   - Education & Certifications\\n' +
    '   - Publications & Awards\\n' +
    '6. Strictly preserve factual integrity: do not fabricate unperformed degrees or techniques.';
}

function buildCoverLetterPrompt(job) {
  const a = job.analysis || {};
  const isDoc = isPhd(job);
  const role = a.actualRole || 'Biotech Scientist';
  const company = a.company || 'Organization';
  const loc = a.location || 'Bangalore, India';
  const strengths = (a.strengths || []).join('; ');
  const tips = (a.applicationTips || []).join('\\n- ');

  if (isDoc) {
    return 'You are an expert Academic Career Mentor and Doctoral Admissions Consultant.\\n\\n' +
      'Write a compelling, articulate 1-page Academic Statement of Purpose / Motivation Letter for Sudakshina Deb applying for the PhD / Doctoral position below:\\n\\n' +
      'PROGRAM / VACANCY:\\n' +
      '- Position: ' + role + '\\n' +
      '- University / Institute: ' + company + '\\n' +
      '- Location: ' + loc + '\\n' +
      '- Matched Strengths: ' + strengths + '\\n\\n' +
      'APPLICANT PROFILE:\\n' +
      '- Sudakshina Deb (Bangalore, India)\\n' +
      '- 4 years industrial R&D experience as Senior Scientist in Downstream Protein Sciences at Syngene International Ltd.\\n' +
      '- Proven wet-lab mastery: AKTA chromatography (Protein A, Ni-NTA, CEX, SEC), mAbs, bispecifics, TFF, SEC-HPLC, Endosafe endotoxin testing, ALCOA++ compliance.\\n' +
      '- Computational capabilities: Python, R, QIIME2 microbiome analysis, AlphaFold2 structure prediction.\\n' +
      '- Academic credentials: M.Sc. Zoology (Honours, First Class) from NEHU Shillong; PG Diploma in Bioinformatics & Genomics (Distinction) from Bversity.\\n' +
      '- Research dissertation: Neurodevelopmental disorder genetics (Fragile X syndrome) in collaboration with Rajiv Gandhi Centre for Biotechnology (RGCB); 1 co-authored peer-reviewed publication.\\n' +
      '- Award: Syngene SPOT Award (Feb 2023).\\n\\n' +
      'INSTRUCTIONS:\\n' +
      '1. Write a professional, passionate, and scientifically rigorous 1-page Motivation Letter.\\n' +
      '2. Explain why this specific doctoral research at ' + company + ' aligns with her trajectory bridging industrial downstream macromolecular bioprocesses and computational biology.\\n' +
      '3. Emphasize how her 4 years of industrial bench discipline and troubleshooting make her uniquely prepared for doctoral research.\\n' +
      '4. Output in clean Markdown format with standard formal academic letter structure.';
  }

  return 'You are an expert Biotech Executive Recruiter and Cover Letter Strategist.\\n\\n' +
    'Write a persuasive, tailored, and highly engaging 1-page Cover Letter for Sudakshina Deb applying for the following industry role:\\n\\n' +
    'TARGET ROLE:\\n' +
    '- Role: ' + role + '\\n' +
    '- Company: ' + company + '\\n' +
    '- Location: ' + loc + '\\n' +
    '- Matched Core Strengths: ' + strengths + '\\n' +
    '- Key Guidance / Application Tips:\\n- ' + tips + '\\n\\n' +
    'CANDIDATE BACKGROUND:\\n' +
    '- Sudakshina Deb (Bangalore, India | Senior Scientist at Syngene International Ltd., 4 years)\\n' +
    '- Downstream protein purification, AKTA Pure/Avant (Protein A, Ni-NTA, IEX, SEC), mAbs, bispecifics, TFF, SEC-HPLC, LAL endotoxin assays, ALCOA++, SPOT Award.\\n' +
    '- Computational tools: Python, R, QIIME2, AlphaFold2.\\n' +
    '- Degrees: M.Sc. Zoology (First Class, NEHU), PG Diploma Bioinformatics (Bversity).\\n\\n' +
    'INSTRUCTIONS:\\n' +
    '1. Craft an impactful 1-page Cover Letter tailored directly to ' + company + '\\\'s mission and the ' + role + ' requirements.\\n' +
    '2. Hook the hiring manager in the opening paragraph with relevant achievements and enthusiasm for ' + company + '.\\n' +
    '3. Highlight her downstream purification mastery (AKTA, mAbs, bispecifics, SEC-HPLC) and analytical rigor.\\n' +
    '4. Conclude with a strong, confident call to action for an interview.\\n' +
    '5. Format in clean GitHub-flavored Markdown.';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modalBg = document.getElementById('resume-modal-bg');
    if (modalBg && modalBg.classList.contains('open')) {
      closeResumeModal();
    } else {
      closeDrawer();
    }
  }
});
load();
</script>
</body>
</html>`;
