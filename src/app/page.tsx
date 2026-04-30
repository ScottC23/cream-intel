'use client'

import { useState, useCallback } from 'react'

/* ── Nav config ── */
const NAV = [
  { id: 'scan',         label: 'New scan',      feat: 'F01', icon: '✦' },
  { id: 'pipeline',     label: 'Pipeline',      feat: 'F02–03', icon: '◈' },
  { id: 'evidence',     label: 'Evidence',      feat: 'F04–06', icon: '◎' },
  { id: 'stakeholders', label: 'Stakeholders',  feat: 'F07', icon: '◉' },
  { id: 'outreach',     label: 'Outreach',      feat: 'F08–09', icon: '◆' },
  { id: 'export',       label: 'Export',        feat: 'F10', icon: '⬡' },
  { id: 'providers',    label: 'Providers',     feat: 'F11', icon: '⬢' },
]

const SUBTITLES: Record<string, string> = {
  scan: 'Define a US company intelligence scan across public and private tracks.',
  pipeline: 'SEC EDGAR lookup, private company resolver, and source collection.',
  evidence: 'Signal extraction, evidence scoring, and company evidence view.',
  stakeholders: 'Stakeholder role mapping with sales action layer.',
  outreach: 'Outreach angle builder and message drafting.',
  export: 'Full account summary export.',
  providers: 'Provider upgrade hooks for data enrichment.',
}

const DESCRIPTIONS: Record<string, string> = {
  pipeline: 'Runs SEC EDGAR lookup for public companies and Form D resolver for private companies in parallel. Applies the five-dimension private scoring model and retrieves filing metadata for public companies. Hybrid entities are handled across both source sets.',
  evidence: 'Extracts signals from collected source excerpts using recency decay, corroboration bonuses, and stage-adjusted confidence caps. Scores all companies using the public four-dimension or private five-dimension weighted model. 12-month hard cutoff applied — sources older than 365 days are excluded from scoring.',
  stakeholders: 'Maps extracted signals to senior roles with recommended use actions, evidence confidence scores, inference risk ratings, cold call topic menus, and suggested first questions. Applies flat-org private company rules at Seed and Series A.',
  outreach: 'Generates LinkedIn connection messages under 300 characters with first name placeholder reserved, and first-touch emails at 120 to 160 words. Three tone options: consultative, direct, challenger. No dashes enforced throughout.',
  export: 'Full account summary with evidence chain, dimension scores, stakeholder roles, cold call topics, and outreach drafts. Copy to clipboard or download as a dated plain text file per account.',
  providers: 'Architecture-ready provider slots for Crunchbase Pro, PitchBook, Apollo, Lightcast, BuiltWith, Clay, earnings transcript feeds, and CRM integration. Each provider defines its dimension impact and adapter interface contract.',
}

/* ── Themes ── */
const THEMES = [
  { id: 'data',       label: 'Data capability',        color: '#1A4A7A' },
  { id: 'ai',         label: 'AI readiness',           color: '#3B2D6B' },
  { id: 'automation', label: 'Automation',             color: '#2D4A3E' },
  { id: 'tom',        label: 'Operating model change', color: '#6B4A1A' },
  { id: 'cost',       label: 'Cost transformation',    color: '#7A2020' },
  { id: 'ops',        label: 'Operational improvement',color: '#3B6D11' },
]

const TICKER_RE = /^[A-Z]{1,5}$/

interface ParsedCo { value: string; type: 'name' | 'ticker'; src: string }

function parseList(raw: string): ParsedCo[] {
  if (!raw.trim()) return []
  const out: ParsedCo[] = []
  const seen = new Set<string>()
  for (const line of raw.split(/[\n\r]+/)) {
    for (let part of line.split(/[\t,]+/)) {
      part = part.replace(/^\s*\d+[\.\)\-\:]\s*/, '').replace(/["""'']/g, '').trim()
      if (!part || part.length < 2) continue
      const key = part.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const up = part.toUpperCase()
      out.push({ value: TICKER_RE.test(up) ? up : part, type: TICKER_RE.test(up) ? 'ticker' : 'name', src: 'list' })
    }
  }
  return out
}

/* ── Main app ── */
export default function App() {
  const [active, setActive] = useState('scan')
  const [scanDone, setScanDone] = useState(false)

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-wordmark">
            <span className="logo-dot" />
            Cream
          </div>
          <div className="logo-tagline">Company Intelligence</div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav-item ${active === n.id ? 'active' : ''}`}
              onClick={() => setActive(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              <div className="nav-label-group">
                <span className="nav-label">{n.label}</span>
                <span className="nav-feat">{n.feat}</span>
              </div>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="version-row">
            <span className="version-tag">v0.1.0</span>
            <div className="api-pill">
              <span className="api-dot" />
              Live
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <div className="content-header">
          <div className="header-left">
            <div className="page-eyebrow">{NAV.find(n => n.id === active)?.feat}</div>
            <h1 className="page-title">{NAV.find(n => n.id === active)?.label}</h1>
            <p className="page-subtitle">{SUBTITLES[active]}</p>
          </div>
          {scanDone && active === 'scan' && (
            <div className="header-badge">✓ Scan created</div>
          )}
        </div>

        <div className="content-scroll">
          {active === 'scan'
            ? <ScanForm onCreated={() => setScanDone(true)} />
            : <ComingSoon feat={NAV.find(n => n.id === active)?.feat ?? ''} title={NAV.find(n => n.id === active)?.label ?? ''} desc={DESCRIPTIONS[active] ?? ''} />
          }
        </div>
      </main>
    </div>
  )
}

/* ── Scan form ── */
function ScanForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [ticker, setTicker] = useState('')
  const [list, setList] = useState('')
  const [themes, setThemes] = useState<Set<string>>(new Set())
  const [sam, setSam] = useState(false)
  const [errors, setErrors] = useState<{ co?: string; themes?: string }>({})
  const [created, setCreated] = useState<Record<string, unknown> | null>(null)
  const [creating, setCreating] = useState(false)

  const companies = useCallback((): ParsedCo[] => {
    const out: ParsedCo[] = []
    const seen = new Set<string>()
    if (name.trim()) { seen.add(name.trim().toLowerCase()); out.push({ value: name.trim(), type: 'name', src: 'name' }) }
    if (ticker.trim()) {
      const up = ticker.trim().toUpperCase()
      if (TICKER_RE.test(up) && !seen.has(up.toLowerCase())) { seen.add(up.toLowerCase()); out.push({ value: up, type: 'ticker', src: 'ticker' }) }
    }
    for (const c of parseList(list)) {
      if (!seen.has(c.value.toLowerCase())) { seen.add(c.value.toLowerCase()); out.push(c) }
    }
    return out
  }, [name, ticker, list])

  const toggleTheme = (id: string) => {
    setThemes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    setErrors(e => ({ ...e, themes: undefined }))
  }

  const removeCompany = (idx: number) => {
    const cos = companies()
    const rem = cos[idx]
    if (rem.src === 'name') setName('')
    else if (rem.src === 'ticker') setTicker('')
    else {
      const lines = list.split(/[\n\r]+/).filter(l => {
        const clean = l.replace(/^\s*\d+[\.\)\-\:]\s*/, '').replace(/["""'']/g, '').trim()
        return clean.toLowerCase() !== rem.value.toLowerCase()
      })
      setList(lines.join('\n'))
    }
  }

  const validate = () => {
    const e: { co?: string; themes?: string } = {}
    if (companies().length === 0) e.co = 'Add at least one company name, ticker, or paste a list.'
    if (themes.size === 0) e.themes = 'Select at least one signal theme.'
    setErrors(e)
    return !e.co && !e.themes
  }

  const handleCreate = async () => {
    if (!validate()) return
    setCreating(true)
    await new Promise(r => setTimeout(r, 500))
    const cos = companies()
    const scan = {
      id: 'CRM-' + Date.now().toString(36).toUpperCase(),
      status: 'created',
      market: 'US',
      sourceMode: 'low_cost_public',
      companies: cos.map(c => ({ value: c.value, type: c.type })),
      signalThemes: Array.from(themes),
      samGovEnrichment: sam,
      createdAt: new Date().toISOString(),
    }
    setCreated(scan)
    setCreating(false)
    onCreated()
  }

  const cos = companies()

  if (created) {
    const scan = created as { id: string; companies: unknown[]; signalThemes: string[] }
    return (
      <div>
        <div className="success-banner">
          <div className="success-icon">✓</div>
          <div className="success-body">
            <div className="success-title">Scan created successfully</div>
            <div className="success-meta">
              ID: <code>{scan.id}</code> · {scan.companies.length} {scan.companies.length === 1 ? 'company' : 'companies'} · {scan.signalThemes.length} signal {scan.signalThemes.length === 1 ? 'theme' : 'themes'} · status: <code>created</code>
            </div>
          </div>
          <button className="btn-secondary" onClick={() => { setCreated(null); setName(''); setTicker(''); setList(''); setThemes(new Set()); setSam(false) }}>
            New scan
          </button>
        </div>

        <div className="ornament">
          <span className="ornament-line" />
          <span className="ornament-mark">✦ ✦ ✦</span>
          <span className="ornament-line" />
        </div>

        <div className="coming-soon">
          <div className="coming-card">
            <div className="coming-header">
              <span className="feat-pill">NEXT</span>
              <h2 className="coming-title">Continue to pipeline</h2>
            </div>
            <p className="coming-desc">
              Your scan is ready. The pipeline will resolve all {scan.companies.length} {scan.companies.length === 1 ? 'company' : 'companies'} against SEC EDGAR and Form D records, collect sources across all source types, and begin signal extraction. Navigate to Pipeline in the sidebar to continue when the full workflow is wired up.
            </p>
            <div className="coming-note">
              The full F02 through F11 workflow — resolution, source collection, signal extraction, evidence scoring, stakeholder mapping, and outreach drafting — is ready to be connected as React components in <code>src/app/page.tsx</code>.
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">

      {/* Company input */}
      <div className="card-section">
        <div className="section-label">Company input</div>
        <div className="input-row">
          <div className="field-wrap">
            <label className="field-label">Company name</label>
            <input
              type="text"
              placeholder="e.g. Terabase Energy"
              value={name}
              onChange={e => { setName(e.target.value); setErrors(v => ({ ...v, co: undefined })) }}
              className={errors.co ? 'input-error' : ''}
            />
          </div>
          <div className="field-wrap">
            <label className="field-label">Ticker symbol</label>
            <input
              type="text"
              placeholder="e.g. LECO"
              value={ticker}
              onChange={e => { setTicker(e.target.value.toUpperCase()); setErrors(v => ({ ...v, co: undefined })) }}
              className={errors.co ? 'input-error' : ''}
            />
          </div>
        </div>

        <div className="field-wrap">
          <label className="field-label">Company list</label>
          <textarea
            placeholder={'Paste any format — numbered lists, tabs, commas, or one per line.\nNumbering and formatting are stripped automatically.\n\nExample:\n1. Terabase Energy\n2. Lincoln Electric\n3. CBRE\n4. Generate Biomedicines'}
            value={list}
            onChange={e => { setList(e.target.value); setErrors(v => ({ ...v, co: undefined })) }}
            className={errors.co ? 'input-error' : ''}
            rows={6}
          />
          <span className="field-hint">Accepts company names, tickers, numbered lists, tab-separated columns, and mixed formats</span>
        </div>

        {errors.co && <div className="error-msg">{errors.co}</div>}

        {cos.length > 0 && (
          <div className="parsed-preview">
            <div className="parsed-header">
              <span className="parsed-count">{cos.length} {cos.length === 1 ? 'company' : 'companies'} parsed</span>
              <button className="clear-btn" onClick={() => { setName(''); setTicker(''); setList('') }}>Clear all</button>
            </div>
            <div className="tag-row">
              {cos.map((c, i) => (
                <span key={i} className="co-tag">
                  <span className="tag-type">{c.type}</span>
                  {c.value}
                  <button className="tag-remove" onClick={() => removeCompany(i)}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Signal themes */}
      <div className="card-section">
        <div className="section-label">Signal themes</div>
        <div className="theme-grid">
          {THEMES.map(t => {
            const sel = themes.has(t.id)
            return (
              <button
                key={t.id}
                className="theme-chip"
                onClick={() => toggleTheme(t.id)}
                style={sel ? {
                  borderColor: t.color,
                  background: t.color + '10',
                  boxShadow: `0 0 0 1px ${t.color}30`,
                } : {}}
              >
                <span className="chip-dot" style={{ background: sel ? t.color : undefined }} />
                <span className="chip-label" style={sel ? { color: t.color, fontWeight: 500 } : {}}>{t.label}</span>
              </button>
            )
          })}
        </div>
        {errors.themes && <div className="error-msg" style={{ marginTop: 10 }}>{errors.themes}</div>}
      </div>

      {/* Defaults */}
      <div className="card-section">
        <div className="section-label">Defaults</div>
        <div className="defaults-row">
          <div className="default-badge">
            <div className="default-label">Market</div>
            <div className="default-value">United States</div>
          </div>
          <div className="default-badge">
            <div className="default-label">Source mode</div>
            <div className="default-value">Low cost public</div>
          </div>
        </div>
      </div>

      {/* SAM.gov */}
      <div className="card-section">
        <div className="section-label">Enrichment</div>
        <div className="toggle-row">
          <div className="toggle-info">
            <div className="toggle-title">SAM.gov enrichment</div>
            <div className="toggle-desc">Include federal contractor and public sector signals. Useful for companies with government contracts or defence-adjacent operations.</div>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={sam} onChange={e => setSam(e.target.checked)} />
            <span className="toggle-track" />
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="card-footer">
        <span className="footer-hint">
          {cos.length} {cos.length === 1 ? 'company' : 'companies'} · {themes.size} {themes.size === 1 ? 'theme' : 'themes'} selected
        </span>
        <button className="btn-primary" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating scan…' : 'Create scan →'}
        </button>
      </div>

    </div>
  )
}

/* ── Coming soon ── */
function ComingSoon({ feat, title, desc }: { feat: string; title: string; desc: string }) {
  return (
    <div className="coming-soon">
      <div className="coming-card">
        <div className="coming-header">
          <span className="feat-pill">{feat}</span>
          <h2 className="coming-title">{title}</h2>
        </div>
        <p className="coming-desc">{desc}</p>
        <div className="coming-note">
          This feature is architecturally complete. Add the React component to <code>src/app/page.tsx</code> to activate it in the UI.
        </div>
      </div>
    </div>
  )
}
