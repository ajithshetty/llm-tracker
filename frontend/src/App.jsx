import React, { useState, useMemo, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Download, Heart, Lock, Unlock, DollarSign, Layers, Clock, ExternalLink, RefreshCw, Info, Zap, ZapOff } from "lucide-react";

/* ---------------------------------------------------------------------- */
/* This dashboard no longer talks to Hugging Face directly. It talks only */
/* to the FastAPI backend:                                                */
/*   GET  /api/status      -> { live_fetch_enabled, last_updated, ... }    */
/*   GET  /api/models      -> the last data written to disk               */
/*   POST /api/fetch-live  -> re-run sources -> Claude -> disk pipeline    */
/* Change API_BASE to wherever you deploy the backend.                     */
/* ---------------------------------------------------------------------- */

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

// Static mode: no backend at all (e.g. GitHub Pages). Models are read
// straight from a JSON file committed to the repo and refreshed by a
// scheduled GitHub Action instead of a live "Fetch live data" button.
const STATIC_MODE = import.meta.env.VITE_STATIC_MODE === "true";
const STATIC_DATA_URL = `${import.meta.env.BASE_URL}data/models.json`;
const REPO_URL = import.meta.env.VITE_REPO_URL || "";

const PROVIDER_COLOR = {
  OpenAI: "#2BB893",
  Anthropic: "#D97757",
  Google: "#5AC8E0",
  xAI: "#C9CDD3",
  Meta: "#5C7CFA",
  DeepSeek: "#8B7CFF",
  Mistral: "#FF8A3D",
  Alibaba: "#C266FF",
};
const FALLBACK_COLOR = "#8B929C";
const colorFor = (p) => PROVIDER_COLOR[p] || FALLBACK_COLOR;

/* ---------------------------------------------------------------------- */
/* Helpers                                                                  */
/* ---------------------------------------------------------------------- */

function fmtContext(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M tokens";
  return (n / 1000).toFixed(0) + "K tokens";
}
function fmtDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtCount(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
function fmtTimestamp(iso) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// The backend returns snake_case fields (open_weights, price_in, hf_downloads,
// release_approx, hf_status). Normalize to the shape the rest of this
// component expects.
function normalizeModel(m) {
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    release: m.release,
    releaseApprox: !!m.release_approx,
    context: m.context,
    priceIn: m.price_in ?? null,
    priceOut: m.price_out ?? null,
    open: !!m.open_weights,
    hfRepo: m.hf_repo ?? null,
    hfDownloads: m.hf_downloads ?? null,
    hfLikes: m.hf_likes ?? null,
    hfStatus: m.hf_status ?? "n/a",
  };
}

/* ---------------------------------------------------------------------- */
/* Release ticker — the signature element. y = price tier (log), r = ctx  */
/* window (log). Both are real, sourced numbers, not invented metrics.    */
/* ---------------------------------------------------------------------- */

function ReleaseTicker({ models, selectedId, onSelect }) {
  const sorted = useMemo(() => [...models].sort((a, b) => new Date(a.release) - new Date(b.release)), [models]);
  if (sorted.length === 0) return null;
  const minDate = new Date(sorted[0].release).getTime();
  const maxDate = new Date(sorted[sorted.length - 1].release).getTime();
  const W = 1040, H = 150, PAD = 26;
  const baseline = H - 30;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pulse-svg" preserveAspectRatio="xMidYMid meet">
      <line x1={PAD} y1={baseline} x2={W - PAD} y2={baseline} stroke="#262B33" strokeWidth="1.5" />
      {sorted.map((m) => {
        const x = PAD + ((new Date(m.release).getTime() - minDate) / (maxDate - minDate || 1)) * (W - PAD * 2);
        const hasPrice = m.priceIn != null;
        const y = hasPrice ? baseline - 14 - Math.log10(m.priceIn + 0.05) * 34 : baseline - 10;
        const r = 3 + Math.log10(Math.max(m.context, 1000) / 1000) * 2.1;
        const isSelected = m.id === selectedId;
        return (
          <g key={m.id} onClick={() => onSelect(m)} className="pulse-node" style={{ cursor: "pointer" }}>
            <line x1={x} y1={baseline} x2={x} y2={y} stroke={colorFor(m.provider)} strokeWidth="1" opacity="0.3" strokeDasharray={hasPrice ? "0" : "2,2"} />
            <circle
              cx={x} cy={y} r={isSelected ? r + 3 : r}
              fill={colorFor(m.provider)}
              opacity={isSelected ? 1 : 0.75}
              stroke={m.open ? "#ECEEF1" : isSelected ? "#7FE7CF" : "none"}
              strokeWidth={m.open ? (isSelected ? 2.5 : 1.2) : isSelected ? 2.5 : 0}
              strokeOpacity={m.open && !isSelected ? 0.55 : 1}
            />
            {isSelected && (
              <text x={x} y={y - r - 10} textAnchor="middle" fill="#ECEEF1" fontSize="11" fontFamily="IBM Plex Mono, monospace">
                {m.name}
              </text>
            )}
          </g>
        );
      })}
      <text x={PAD} y={H - 8} fill="#575D66" fontSize="10" fontFamily="IBM Plex Mono, monospace">↑ higher = pricier per token</text>
      <text x={W - PAD} y={H - 8} fill="#575D66" fontSize="10" fontFamily="IBM Plex Mono, monospace" textAnchor="end">bigger dot = larger context window</text>
    </svg>
  );
}

/* ---------------------------------------------------------------------- */
/* Tooltips                                                                 */
/* ---------------------------------------------------------------------- */

function PriceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{d.name}</div>
      <div className="tt-value">${d.priceIn.toFixed(2)} in / ${d.priceOut.toFixed(2)} out per 1M tokens</div>
    </div>
  );
}

function DownloadsTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{d.name}</div>
      <div className="tt-value">{fmtCount(d.hfDownloads)} recent Hugging Face downloads</div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Main app                                                                 */
/* ---------------------------------------------------------------------- */

export default function App() {
  const [models, setModels] = useState([]);
  const [summary, setSummary] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [liveFetchEnabled, setLiveFetchEnabled] = useState(false);
  const [loadState, setLoadState] = useState("loading"); // loading | ready | empty | error
  const [fetchLiveState, setFetchLiveState] = useState("idle"); // idle | running | error
  const [fetchLiveError, setFetchLiveError] = useState(null);

  const [provider, setProvider] = useState(null);
  const [modelId, setModelId] = useState(null);

  const loadStatus = useCallback(async () => {
    if (STATIC_MODE) {
      setLiveFetchEnabled(false); // no backend to fetch live from
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      const data = await res.json();
      setLiveFetchEnabled(!!data.live_fetch_enabled);
    } catch {
      setLiveFetchEnabled(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch(STATIC_MODE ? STATIC_DATA_URL : `${API_BASE}/api/models`);
      if (res.status === 404) {
        setLoadState("empty");
        return;
      }
      if (!res.ok) throw new Error(`${STATIC_MODE ? "Static file" : "API"} ${res.status}`);
      const data = await res.json();
      const normalized = (data.models || []).map(normalizeModel);
      setModels(normalized);
      setSummary(data.summary ?? null);
      setGeneratedAt(data.generated_at ?? null);
      if (normalized.length === 0) {
        setLoadState("empty");
        return;
      }
      setLoadState("ready");
      setProvider((prev) => prev || normalized[0].provider);
      setModelId((prev) => prev || normalized[0].id);
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadModels();
  }, [loadStatus, loadModels]);

  const providers = useMemo(() => [...new Set(models.map((m) => m.provider))], [models]);

  const modelsByProvider = useMemo(
    () => models.filter((m) => m.provider === provider).sort((a, b) => new Date(b.release) - new Date(a.release)),
    [models, provider]
  );

  useEffect(() => {
    if (provider && !modelsByProvider.find((m) => m.id === modelId)) {
      setModelId(modelsByProvider[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, models]);

  const selected = models.find((m) => m.id === modelId) || null;

  function handleSelect(m) {
    setProvider(m.provider);
    setModelId(m.id);
  }

  async function handleFetchLive() {
    setFetchLiveState("running");
    setFetchLiveError(null);
    try {
      const res = await fetch(`${API_BASE}/api/fetch-live`, { method: "POST" });
      if (res.status === 423) {
        setFetchLiveError("Live fetch is currently disabled by the administrator.");
        setFetchLiveState("error");
        await loadStatus();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }
      await loadModels();
      setFetchLiveState("idle");
    } catch (err) {
      setFetchLiveError(err.message || "Something went wrong.");
      setFetchLiveState("error");
    }
  }

  const pricedModels = useMemo(
    () => models.filter((m) => m.priceIn != null).slice().sort((a, b) => a.priceIn - b.priceIn),
    [models]
  );

  const openRanking = useMemo(
    () => models.filter((m) => m.open && m.hfStatus === "success").slice().sort((a, b) => (b.hfDownloads ?? 0) - (a.hfDownloads ?? 0)),
    [models]
  );

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .app { background: #0B0D10; color: #ECEEF1; font-family: 'Inter', sans-serif; min-height: 100vh; padding: 40px 24px 64px; }
        .shell { max-width: 1080px; margin: 0 auto; }
        .eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #7FE7CF; margin-bottom: 14px; }
        .top-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
        .title { font-family: 'Fraunces', serif; font-optical-sizing: auto; font-weight: 600; font-size: clamp(32px, 5vw, 52px); line-height: 1.05; margin: 0 0 14px; color: #F5F6F7; }
        .subtitle { font-size: 15px; color: #8B929C; max-width: 640px; line-height: 1.55; margin: 0 0 6px; }
        .disclaimer { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: #7A828C; margin: 10px 0 22px; border-left: 2px solid #2A2F38; padding-left: 10px; line-height: 1.6; max-width: 720px; }
        .live-panel { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; min-width: 220px; }
        .fetch-btn { background: #7FE7CF; color: #0B0D10; border: none; border-radius: 9px; padding: 11px 16px; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
        .fetch-btn:hover:not(:disabled) { background: #9BF0DE; }
        .fetch-btn:disabled { background: #262B33; color: #575D66; cursor: not-allowed; }
        .fetch-meta { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: #575D66; text-align: right; }
        .fetch-error { font-size: 11px; color: #E8836B; max-width: 220px; text-align: right; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .pulse-card { background: #14171C; border: 1px solid #21252C; border-radius: 14px; padding: 18px 8px 8px; margin-bottom: 30px; overflow-x: auto; }
        .pulse-svg { width: 100%; height: 150px; display: block; min-width: 640px; }
        .legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 4px 18px 14px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #8B929C; align-items: center; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
        .legend-divider { width: 1px; height: 12px; background: #2A2F38; margin: 0 2px; }
        .controls { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 28px; }
        .select-wrap { position: relative; }
        select { appearance: none; background: #14171C; color: #ECEEF1; border: 1px solid #2A2F38; border-radius: 9px; font-family: 'IBM Plex Mono', monospace; font-size: 13px; padding: 11px 38px 11px 14px; min-width: 200px; cursor: pointer; }
        select:focus { outline: 2px solid #7FE7CF; outline-offset: 1px; }
        .select-wrap::after { content: '▾'; position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: #575D66; pointer-events: none; font-size: 11px; }
        .detail-head { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 10px; margin-bottom: 22px; }
        .model-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 30px; color: #F5F6F7; }
        .tag-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
        .tag { font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 4px 9px; border-radius: 20px; border: 1px solid #2A2F38; color: #B7BCC4; display: flex; align-items: center; gap: 5px; }
        .provider-tag { display: flex; align-items: center; gap: 6px; }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 28px; }
        .stat-card { background: #14171C; border: 1px solid #21252C; border-radius: 12px; padding: 16px; }
        .stat-label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #575D66; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }
        .stat-value { font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; color: #ECEEF1; }
        .stat-sub { font-size: 11px; color: #575D66; margin-top: 4px; }
        .panel-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; }
        @media (max-width: 800px) { .panel-grid { grid-template-columns: 1fr; } }
        .chart-card { background: #14171C; border: 1px solid #21252C; border-radius: 14px; padding: 20px; }
        .chart-title { font-size: 13px; color: #B7BCC4; margin-bottom: 4px; font-weight: 600; }
        .chart-caption { font-size: 11.5px; color: #575D66; margin-bottom: 14px; }
        .chart-tooltip { background: #1C2027; border: 1px solid #2A2F38; border-radius: 8px; padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; }
        .tt-label { font-size: 11px; color: #8B929C; margin-bottom: 3px; }
        .tt-value { font-size: 12.5px; color: #ECEEF1; }
        .closed-card { background: #14171C; border: 1px dashed #2A2F38; border-radius: 14px; padding: 26px; display: flex; gap: 14px; align-items: flex-start; }
        .closed-card svg { flex-shrink: 0; margin-top: 2px; color: #575D66; }
        .closed-card p { margin: 0 0 8px; font-size: 13.5px; color: #B7BCC4; line-height: 1.6; }
        .closed-card a { color: #7FE7CF; }
        .hf-link { font-size: 11px; color: #575D66; margin-top: 8px; display: inline-flex; align-items: center; gap: 4px; }
        .hf-link a { color: #7FE7CF; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; }
        .center-msg { text-align: center; padding: 80px 20px; color: #575D66; font-size: 14px; }
        .center-msg .fetch-btn { margin-top: 16px; }
        .summary-card { background: #14171C; border: 1px solid #21252C; border-radius: 12px; padding: 14px 16px; margin-bottom: 24px; font-size: 13px; color: #B7BCC4; line-height: 1.6; }
        .summary-card b { color: #7FE7CF; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; display: block; margin-bottom: 6px; }
      `}</style>

      <div className="shell">
        <div className="top-row">
          <div>
            <div className="eyebrow">Model Release Tracker</div>
            <h1 className="title">Release Ledger</h1>
            <p className="subtitle">
              Every major frontier and open-weight release, plotted by launch date —
              height maps to input price per token, dot size to context window.
              Data comes from your backend's <code>/api/models</code> endpoint.
            </p>
          </div>
          <div className="live-panel">
            {STATIC_MODE ? (
              <>
                <div className="fetch-meta" style={{ fontSize: 11.5, color: "#8B929C" }}>
                  Refreshed by a scheduled GitHub Action
                </div>
                {REPO_URL && (
                  <a className="hf-link" href={`${REPO_URL}`} target="_blank" rel="noreferrer">
                    <ExternalLink size={11} /> View in GitHub
                  </a>
                )}
              </>
            ) : (
              <button
                className="fetch-btn"
                disabled={!liveFetchEnabled || fetchLiveState === "running"}
                onClick={handleFetchLive}
                title={!liveFetchEnabled ? "Disabled by the administrator (features.enable_live_fetch=false)" : "Fetch live data"}
              >
                {fetchLiveState === "running" ? <RefreshCw size={14} className="spin" /> : liveFetchEnabled ? <Zap size={14} /> : <ZapOff size={14} />}
                {fetchLiveState === "running" ? "Fetching…" : "Fetch live data"}
              </button>
            )}
            {!STATIC_MODE && (
              <div className="fetch-meta">
                {liveFetchEnabled ? "live fetch enabled" : "live fetch disabled by admin"}
              </div>
            )}
            <div className="fetch-meta">last updated: {fmtTimestamp(generatedAt)}</div>
            {fetchLiveError && <div className="fetch-error">{fetchLiveError}</div>}
          </div>
        </div>

        <p className="disclaimer">
          No provider publishes real usage numbers (weekly active users, request
          volume) for their models, so this dashboard doesn't show any. What's real
          here: release dates, context windows, and pricing maintained by your
          backend, plus live download/like counts from the Hugging Face API for
          open-weight models — all summarized by Claude and written to disk each
          time "Fetch live data" runs.
        </p>

        {summary && (
          <div className="summary-card">
            <b>Claude's summary of the last fetch</b>
            {summary}
          </div>
        )}

        {loadState === "loading" && <div className="center-msg">Loading data from the backend…</div>}

        {loadState === "error" && (
          <div className="center-msg">
            {STATIC_MODE
              ? <>Couldn't load <code>data/models.json</code> from this deployment. Check that the GitHub Actions workflow has run at least once and the file was committed.</>
              : <>Couldn't reach the backend at <code>{API_BASE}</code>. Make sure it's running and CORS is configured for this origin.</>}
          </div>
        )}

        {loadState === "empty" && (
          <div className="center-msg">
            No data has been fetched yet.
            <br />
            {STATIC_MODE
              ? "The scheduled GitHub Action hasn't run yet — trigger it manually from the Actions tab, or wait for the next scheduled run."
              : liveFetchEnabled
                ? <button className="fetch-btn" onClick={handleFetchLive}><Zap size={14} /> Fetch live data</button>
                : "Live fetch is disabled — ask your administrator to enable it or seed data/models.json."}
          </div>
        )}

        {loadState === "ready" && selected && (
          <>
            <div className="pulse-card">
              <ReleaseTicker models={models} selectedId={selected.id} onSelect={handleSelect} />
              <div className="legend">
                {providers.map((p) => (
                  <div className="legend-item" key={p}>
                    <span className="legend-dot" style={{ background: colorFor(p) }} />
                    {p}
                  </div>
                ))}
                <span className="legend-divider" />
                <div className="legend-item"><Unlock size={11} /> open weights</div>
                <div className="legend-item"><Lock size={11} /> closed API</div>
              </div>
            </div>

            <div className="controls">
              <div className="select-wrap">
                <select value={provider ?? ""} onChange={(e) => setProvider(e.target.value)}>
                  {providers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="select-wrap">
                <select value={modelId ?? ""} onChange={(e) => setModelId(e.target.value)}>
                  {modelsByProvider.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>

            <div className="detail-head">
              <div>
                <div className="model-name">{selected.name}</div>
                <div className="tag-row">
                  <span className="tag provider-tag">
                    <span className="legend-dot" style={{ background: colorFor(selected.provider) }} />
                    {selected.provider}
                  </span>
                  <span className="tag">{selected.open ? <Unlock size={11} /> : <Lock size={11} />}{selected.open ? "Open weights" : "Closed API"}</span>
                  <span className="tag">Released {fmtDate(selected.release)}{selected.releaseApprox ? " (approx.)" : ""}</span>
                </div>
              </div>
            </div>

            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label"><Layers size={13} /> Context window</div>
                <div className="stat-value">{fmtContext(selected.context)}</div>
                <div className="stat-sub">max input length</div>
              </div>
              <div className="stat-card">
                <div className="stat-label"><DollarSign size={13} /> Price / 1M tokens</div>
                <div className="stat-value">
                  {selected.priceIn != null ? `$${selected.priceIn.toFixed(2)} / $${selected.priceOut.toFixed(2)}` : "Not listed"}
                </div>
                <div className="stat-sub">{selected.priceIn != null ? "input / output" : "self-hosted, no official API price"}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label"><Clock size={13} /> Days since release</div>
                <div className="stat-value">{Math.floor((Date.now() - new Date(selected.release).getTime()) / 86400000)}</div>
                <div className="stat-sub">as of today</div>
              </div>
              {selected.open ? (
                <>
                  <div className="stat-card">
                    <div className="stat-label"><Download size={13} /> HF downloads</div>
                    <div className="stat-value">
                      {selected.hfStatus === "success" ? fmtCount(selected.hfDownloads) : "—"}
                    </div>
                    <div className="stat-sub">
                      {selected.hfStatus === "error" ? "fetch failed last run" : "via Hugging Face API"}
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label"><Heart size={13} /> HF likes</div>
                    <div className="stat-value">
                      {selected.hfStatus === "success" ? fmtCount(selected.hfLikes) : "—"}
                    </div>
                    <div className="stat-sub">via Hugging Face API</div>
                  </div>
                </>
              ) : (
                <div className="stat-card" style={{ gridColumn: "span 2" }}>
                  <div className="stat-label"><Lock size={13} /> Usage data</div>
                  <div className="stat-value" style={{ fontSize: 15 }}>Not publicly disclosed</div>
                  <div className="stat-sub">{selected.provider} doesn't publish user or request counts</div>
                </div>
              )}
            </div>

            <div className="panel-grid">
              <div className="chart-card">
                <div className="chart-title">Price per 1M tokens</div>
                <div className="chart-caption">Input token price across every model with a published rate</div>
                <ResponsiveContainer width="100%" height={420}>
                  <BarChart data={pricedModels} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fill: "#575D66", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#8B929C", fontSize: 10.5 }} axisLine={false} tickLine={false} width={128} />
                    <Tooltip content={<PriceTooltip />} cursor={{ fill: "#1C2027" }} />
                    <Bar dataKey="priceIn" radius={[0, 4, 4, 0]}>
                      {pricedModels.map((d) => (
                        <Cell key={d.id} fill={colorFor(d.provider)} opacity={d.id === selected.id ? 1 : 0.55} stroke={d.id === selected.id ? "#7FE7CF" : "none"} strokeWidth={d.id === selected.id ? 2 : 0} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                {selected.open ? (
                  <>
                    <div className="chart-title">Open-weight downloads</div>
                    <div className="chart-caption">Live Hugging Face download counts — closed API models aren't included, since only open-weight repos have this figure</div>
                    {openRanking.length === 0 ? (
                      <div style={{ color: "#575D66", fontSize: 12.5, padding: "30px 4px" }}>
                        No successful Hugging Face fetches in the last run yet.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={420}>
                        <BarChart data={openRanking} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                          <XAxis type="number" tick={{ fill: "#575D66", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCount} />
                          <YAxis type="category" dataKey="name" tick={{ fill: "#8B929C", fontSize: 10.5 }} axisLine={false} tickLine={false} width={128} />
                          <Tooltip content={<DownloadsTooltip />} cursor={{ fill: "#1C2027" }} />
                          <Bar dataKey="hfDownloads" radius={[0, 4, 4, 0]}>
                            {openRanking.map((d) => (
                              <Cell key={d.id} fill={colorFor(d.provider)} opacity={d.id === selected.id ? 1 : 0.55} stroke={d.id === selected.id ? "#7FE7CF" : "none"} strokeWidth={d.id === selected.id ? 2 : 0} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </>
                ) : (
                  <div className="closed-card">
                    <Info size={22} />
                    <div>
                      <p>
                        {selected.name} is a closed, API-only model — {selected.provider} doesn't
                        release weights, so there's no download count, and it doesn't publish
                        active-user or request-volume figures either.
                      </p>
                      <p>What you can verify independently: pricing and context window (shown
                        above), and third-party benchmark leaderboards like Artificial Analysis
                        or LMArena for relative capability.</p>
                      <a className="hf-link" href="https://lmarena.ai" target="_blank" rel="noreferrer">
                        <ExternalLink size={11} /> Check LMArena rankings
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
