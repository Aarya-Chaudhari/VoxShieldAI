"use client";

import {
  Activity, ArrowDown, ArrowRight, AudioLines, Check, ChevronRight, CircleDot,
  ClipboardCheck, FileCheck2, FileText, GitBranch, ListChecks, LockKeyhole,
  Menu, Mic2, Network, Radio, Shield, ShieldCheck, Sparkles, Waves, X,
} from "lucide-react";
import { useEffect, useState } from "react";

const capabilities = [
  {
    number: "01",
    icon: Mic2,
    title: "Voice-powered investigation",
    description: "Turn spoken or typed incident updates into a structured investigation, with Gnani Prisma STT when configured.",
    tags: ["Prisma STT", "Voice + text"],
    color: "blue",
  },
  {
    number: "02",
    icon: ShieldCheck,
    title: "Evidence intelligence",
    description: "Keep observations, hypotheses, and evidence organized—and make reported information distinct from confirmed findings.",
    tags: ["Evidence status", "Analyst verified"],
    color: "cyan",
  },
  {
    number: "03",
    icon: Network,
    title: "Investigation completeness",
    description: "See information gaps, explore relationships, and get useful questions and next-step tasks for analyst review.",
    tags: ["Knowledge graph", "Next steps"],
    color: "violet",
  },
  {
    number: "04",
    icon: FileCheck2,
    title: "Traceable reporting",
    description: "Follow the investigation history and generate a structured report from the incident information you have recorded.",
    tags: ["Audit trail", "Markdown reports"],
    color: "blue",
  },
];

const workflow = [
  { index: "01", label: "SPEAK", title: "Share what you know", detail: "Give an update by voice or text. The analyst remains in control." },
  { index: "02", label: "STRUCTURE", title: "Turn updates into context", detail: "Organize incident statements into a consistent investigation record." },
  { index: "03", label: "INVESTIGATE", title: "Connect the details", detail: "Review the timeline, evidence, hypotheses, and suggested tasks together." },
  { index: "04", label: "REVIEW", title: "Keep decisions traceable", detail: "Verify evidence and correct details with an auditable history." },
  { index: "05", label: "REPORT", title: "Bring it into focus", detail: "Create a readable report from the persisted investigation state." },
];

const waveformHeights = [18, 30, 22, 42, 27, 52, 34, 24, 45, 28, 58, 36, 22, 48, 31, 55, 24, 40, 30, 50, 25, 38, 19, 44, 27, 53, 34, 21, 43, 29, 48, 23, 38, 18, 31, 22];

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="home-wordmark">
      <span className="home-mark" aria-hidden="true"><Shield size={20} strokeWidth={1.7} /><AudioLines size={11} /></span>
      <span>VOX<span className="home-wordmark-light">SHIELD</span>{compact ? null : <span className="home-wordmark-dot">®</span>}</span>
    </span>
  );
}

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return <div className={`home-reveal ${className}`} style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}>{children}</div>;
}

function HeroSignal({ className, children }: { className: string; children: React.ReactNode }) {
  return <div className={`hero-signal ${className}`} aria-hidden="true">{children}</div>;
}

export function VoxShieldHomepage() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  useEffect(() => {
    const updateScroll = () => setScrolled(window.scrollY > 24);
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".home-reveal").forEach((element) => revealObserver.observe(element));

    return () => {
      window.removeEventListener("scroll", updateScroll);
      revealObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const validExternalUrl = (value: string | undefined) => {
      if (!value) return "";
      try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.toString() : "";
      } catch {
        return "";
      }
    };
    setGithubUrl(validExternalUrl(process.env.NEXT_PUBLIC_GITHUB_URL));
    setLinkedinUrl(validExternalUrl(process.env.NEXT_PUBLIC_LINKEDIN_URL));
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <main className="home-shell">
      <header className={`home-header${scrolled ? " home-header-scrolled" : ""}`}>
        <div className="home-header-inner">
          <a className="home-brand-link" href="#top" aria-label="VOXSHIELD home" onClick={closeMenu}><Wordmark /></a>
          <button className="home-menu-toggle" type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <nav className={`home-nav${menuOpen ? " home-nav-open" : ""}`} aria-label="Main navigation">
            <a href="#product" onClick={closeMenu}>Product</a>
            <a href="#capabilities" onClick={closeMenu}>Capabilities</a>
            <a href="#workflow" onClick={closeMenu}>How it works</a>
            <a href="#technology" onClick={closeMenu}>Technology</a>
            {githubUrl && <a href={githubUrl} target="_blank" rel="noreferrer">GitHub <ArrowRight size={13} /></a>}
            <a className="home-nav-cta" href="/dashboard" onClick={closeMenu}>Launch console <ArrowRight size={14} /></a>
          </nav>
        </div>
      </header>

      <section className="home-hero" id="top">
        <div className="home-hero-grid" aria-hidden="true" />
        <div className="home-hero-glow home-hero-glow-left" aria-hidden="true" />
        <div className="home-hero-glow home-hero-glow-right" aria-hidden="true" />
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <div className="home-eyebrow"><span className="eyebrow-pulse" /> AI-POWERED INCIDENT INVESTIGATION</div>
            <h1>Investigate<br /><span>Smarter.</span> Respond<br className="hero-mobile-break" /> with <span className="hero-clarity">Clarity.</span></h1>
            <p className="home-hero-description">An AI-powered investigation workspace that transforms natural-language incident updates into structured timelines, traceable evidence, actionable tasks, and comprehensive incident reports.</p>
            <div className="home-hero-actions">
              <a className="home-button home-button-primary" href="/dashboard">Launch VOXSHIELD <ArrowRight size={16} /></a>
              <a className="home-button home-button-secondary" href="#capabilities">Explore capabilities <ArrowDown size={15} /></a>
            </div>
            <div className="hero-trust-note"><LockKeyhole size={13} /><span>Analyst-led. Traceable by design.</span><span className="trust-divider" /><span>Voice + text workflow</span></div>
          </div>

          <div className="hero-visual" role="img" aria-label="Illustrative visualization of connected investigation signals">
            <div className="hero-visual-vignette" aria-hidden="true" />
            <svg className="hero-network" viewBox="0 0 640 600" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="networkLine" x1="120" y1="110" x2="526" y2="500" gradientUnits="userSpaceOnUse"><stop stopColor="#3478FF" stopOpacity=".05" /><stop offset=".52" stopColor="#58D9F5" stopOpacity=".58" /><stop offset="1" stopColor="#8875FF" stopOpacity=".08" /></linearGradient>
                <radialGradient id="coreGlow"><stop stopColor="#2077FF" stopOpacity=".24" /><stop offset="1" stopColor="#07111F" stopOpacity="0" /></radialGradient>
              </defs>
              <circle cx="322" cy="295" r="248" fill="url(#coreGlow)" />
              <circle className="orbit orbit-one" cx="322" cy="295" r="196" stroke="url(#networkLine)" strokeDasharray="2 7" />
              <circle className="orbit orbit-two" cx="322" cy="295" r="144" stroke="url(#networkLine)" strokeDasharray="1 9" />
              <path d="M92 218 188 246 276 155 381 195 501 118M105 393l116-55 82 70 109-60 121 51M188 246l33 92m55-183 27 253m78-213 30 153m-219-62 159 10 92-51" stroke="url(#networkLine)" strokeWidth="1" />
              <path className="network-flow" d="M92 218 188 246 276 155 381 195 501 118M105 393l116-55 82 70 109-60 121 51" stroke="#77E6FF" strokeOpacity=".7" strokeWidth="1.5" strokeDasharray="3 12" />
              <circle cx="92" cy="218" r="3" fill="#5ADFFF" /><circle cx="188" cy="246" r="4" fill="#66A7FF" /><circle cx="276" cy="155" r="3" fill="#7B8CFF" /><circle cx="381" cy="195" r="4" fill="#62E5FF" /><circle cx="501" cy="118" r="3" fill="#9B8BFF" /><circle cx="105" cy="393" r="3" fill="#65CFFF" /><circle cx="221" cy="338" r="4" fill="#58D9F5" /><circle cx="303" cy="408" r="3" fill="#7788FF" /><circle cx="412" cy="348" r="4" fill="#6EDBFF" /><circle cx="533" cy="399" r="3" fill="#A58DFF" />
            </svg>

            <div className="hero-core">
              <div className="core-ring core-ring-outer" /><div className="core-ring core-ring-inner" />
              <div className="core-icon"><ShieldCheck size={51} strokeWidth={1.2} /><span className="core-wave"><i /><i /><i /><i /><i /><i /><i /></span></div>
              <div className="core-caption">INVESTIGATION<br /><b>IN CONTEXT</b></div>
            </div>

            <HeroSignal className="signal-incident"><span className="signal-icon signal-blue"><Activity size={14} /></span><span><b>Incident detected</b><small>New activity added to timeline</small></span><i className="signal-dot" /></HeroSignal>
            <HeroSignal className="signal-evidence"><span className="signal-icon signal-cyan"><ShieldCheck size={14} /></span><span><b>Evidence updated</b><small>Analyst status recorded</small></span><Check size={13} className="signal-check" /></HeroSignal>
            <HeroSignal className="signal-task"><span className="signal-icon signal-violet"><ListChecks size={14} /></span><span><b>Investigation task</b><small>Suggested next step</small></span><ChevronRight size={14} className="signal-chevron" /></HeroSignal>
            <div className="hero-mini-wave" aria-hidden="true">{waveformHeights.slice(0, 25).map((height, i) => <i key={i} style={{ "--bar-height": `${height}%`, "--bar-delay": `${i * 34}ms` } as React.CSSProperties} />)}</div>
            <div className="hero-visual-caption"><span className="caption-orb" /> Illustrative investigation signals <span className="caption-line" /></div>
          </div>
        </div>
        <a className="hero-scroll" href="#product" aria-label="Scroll to product preview"><span>SCROLL TO EXPLORE</span><ArrowDown size={14} /></a>
      </section>

      <section className="home-product section-wrap" id="product">
        <Reveal className="section-heading">
          <div className="section-kicker"><span>THE WORKSPACE</span><i /></div>
          <h2>From scattered signals<br />to a <span>clearer picture.</span></h2>
          <p>One focused workspace for the details, decisions, and next steps that move an investigation forward.</p>
        </Reveal>
        <Reveal className="product-preview-wrap" delay={100}>
          <div className="preview-topbar">
            <div className="preview-window-dots"><i /><i /><i /></div>
            <div className="preview-tab"><Shield size={12} /> VOXSHIELD <span>/</span> Investigation workspace</div>
            <div className="preview-label"><span /> PRODUCT PREVIEW · SAMPLE DATA</div>
          </div>
          <div className="preview-app">
            <aside className="preview-sidebar">
              <div className="preview-sidebar-brand"><span className="preview-brand-mark"><Shield size={15} /></span><b>VOXSHIELD</b></div>
              <div className="preview-side-caption">WORKSPACE</div>
              <div className="preview-side-link preview-side-active"><Activity size={13} /> Overview</div>
              <div className="preview-side-link"><GitBranch size={13} /> Incident timeline</div>
              <div className="preview-side-link"><ShieldCheck size={13} /> Evidence locker</div>
              <div className="preview-side-link"><ListChecks size={13} /> Investigation tasks</div>
              <div className="preview-side-link"><FileText size={13} /> Reports</div>
              <div className="preview-sidebar-foot"><span className="preview-avatar">A</span><span><b>Analyst workspace</b><small>Review in progress</small></span><CircleDot size={11} /></div>
            </aside>
            <div className="preview-main">
              <div className="preview-main-head">
                <div><span className="preview-breadcrumb">INCIDENT / INVESTIGATION</span><h3>Suspicious admin access</h3><p>Incident overview · Last updated just now</p></div>
                <span className="preview-severity"><i /> HIGH SEVERITY</span>
              </div>
              <div className="preview-metrics">
                <div><span>INVESTIGATION STATUS</span><b><i className="metric-live-dot" /> In progress</b></div>
                <div><span>TIMELINE EVENTS</span><b>08 <small>recorded</small></b></div>
                <div><span>EVIDENCE REVIEW</span><b>03 <small>to verify</small></b></div>
              </div>
              <div className="preview-content-grid">
                <div className="preview-panel timeline-preview">
                  <div className="preview-panel-title"><span><GitBranch size={13} /> Investigation timeline</span><small>REPORTED EVENTS</small></div>
                  <div className="preview-timeline-row"><i className="timeline-node node-blue" /><small>02:14 AM</small><span><b>Successful admin login</b><em>Unfamiliar source · Analyst reported</em></span><span className="preview-pill pill-reported">REPORTED</span></div>
                  <div className="preview-timeline-row"><i className="timeline-node node-violet" /><small>02:19 AM</small><span><b>Unusual file download</b><em>File contents not yet reviewed</em></span><span className="preview-pill pill-unknown">UNKNOWN</span></div>
                  <div className="preview-timeline-row"><i className="timeline-node node-cyan" /><small>02:26 AM</small><span><b>Investigation started</b><em>Authentication logs requested</em></span><span className="preview-pill pill-task">TASK</span></div>
                  <div className="preview-panel-footer"><span>3 of 8 timeline entries</span><ArrowRight size={12} /></div>
                </div>
                <div className="preview-right-stack">
                  <div className="preview-panel evidence-preview">
                    <div className="preview-panel-title"><span><ShieldCheck size={13} /> Evidence locker</span><small>02 ITEMS</small></div>
                    <div className="evidence-item"><span className="evidence-mini-icon"><FileCheck2 size={12} /></span><span><b>Authentication logs</b><small>Awaiting analyst review</small></span><i className="evidence-status" /></div>
                    <div className="evidence-item"><span className="evidence-mini-icon violet"><FileText size={12} /></span><span><b>Downloaded file</b><small>Reported · Not verified</small></span><i className="evidence-status status-muted" /></div>
                  </div>
                  <div className="preview-panel tasks-preview">
                    <div className="preview-panel-title"><span><ClipboardCheck size={13} /> Next steps</span><small>ANALYST REVIEW</small></div>
                    <div className="preview-task"><span className="task-checkbox" /><span><b>Review authentication logs</b><small>High priority</small></span></div>
                    <div className="preview-task"><span className="task-checkbox" /><span><b>Inspect downloaded file</b><small>Evidence collection</small></span></div>
                  </div>
                </div>
              </div>
              <div className="preview-voicebar"><span className="voicebar-mic"><Mic2 size={15} /></span><span className="voicebar-label"><b>Voice copilot</b><small>Conversation ready · analyst-controlled</small></span><span className="preview-wave">{waveformHeights.slice(2, 25).map((height, i) => <i key={i} style={{ "--bar-height": `${height}%` } as React.CSSProperties} />)}</span><span className="voicebar-provider">PRISMA <i /> TIMBRE</span></div>
            </div>
          </div>
          <div className="preview-disclaimer"><LockKeyhole size={11} /> Illustrative product preview. Sample information shown; not live incident data.</div>
        </Reveal>
      </section>

      <section className="home-capabilities section-wrap" id="capabilities">
        <Reveal className="section-heading section-heading-split">
          <div><div className="section-kicker"><span>CAPABILITIES</span><i /></div><h2>Clarity at every<br /><span>step of the work.</span></h2></div>
          <p>Designed to make complex incident context easier to capture, review, and communicate—without taking decisions away from the analyst.</p>
        </Reveal>
        <div className="capability-grid">
          {capabilities.map(({ number, icon: Icon, title, description, tags, color }, index) => (
            <Reveal key={number} delay={index * 75}>
              <article className={`capability-card capability-${color}`}>
                <div className="capability-top"><span className="capability-icon"><Icon size={20} strokeWidth={1.7} /></span><span className="capability-number">{number}</span></div>
                <h3>{title}</h3><p>{description}</p>
                <div className="capability-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                <span className="capability-orb" aria-hidden="true" />
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="home-workflow section-wrap" id="workflow">
        <Reveal className="section-heading">
          <div className="section-kicker"><span>A METHOD THAT MAKES SENSE</span><i /></div>
          <h2>A considered path<br />from <span>signal to story.</span></h2>
          <p>Each update stays connected to its source, so the investigation remains reviewable as it evolves.</p>
        </Reveal>
        <div className="workflow-track">
          {workflow.map((step, index) => (
            <Reveal className="workflow-reveal" key={step.index} delay={index * 85}>
              <article className="workflow-step">
                <div className="workflow-marker"><span>{step.index}</span>{index < workflow.length - 1 && <i />}</div>
                <div className="workflow-copy"><span>{step.label}</span><h3>{step.title}</h3><p>{step.detail}</p></div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="home-voice section-wrap">
        <Reveal className="voice-card">
          <div className="voice-copy">
            <div className="section-kicker"><span>VOICE, IN CONTEXT</span><i /></div>
            <h2>Your investigation.<br /><span>Now conversational.</span></h2>
            <p>Interact with your investigation through natural voice conversations, capture updates, and review structured changes in context.</p>
            <div className="voice-provider-tags"><span><Waves size={14} /> GNANI PRISMA STT</span><span><AudioLines size={14} /> GNANI TIMBRE TTS</span></div>
            <a className="home-text-link" href="/dashboard">Explore the investigation console <ArrowRight size={15} /></a>
          </div>
          <div className="voice-demo" aria-label="Illustrative voice conversation preview">
            <div className="voice-demo-top"><span><span className="voice-demo-dot" /> VOICE SESSION</span><small>ILLUSTRATIVE PREVIEW</small></div>
            <div className="voice-wave-area"><span className="voice-mic-orb"><Mic2 size={22} /></span><div className="voice-waveform">{waveformHeights.map((height, i) => <i key={i} style={{ "--bar-height": `${height}%`, "--bar-delay": `${i * 22}ms` } as React.CSSProperties} />)}</div><span className="voice-wave-label">VOICE INPUT · PRISMA</span></div>
            <div className="voice-message voice-message-user"><span className="message-label">ANALYST UPDATE</span><p>“We found an unfamiliar admin login just before the file download.”</p><span className="message-time">TRANSCRIPT · SAMPLE</span></div>
            <div className="voice-message voice-message-ai"><span className="message-label"><Sparkles size={12} /> INVESTIGATION COPILOT</span><p>“I’ve added both events to the timeline. The download remains unverified. Would you like to review the suggested next steps?”</p><span className="message-time">ILLUSTRATIVE RESPONSE · TIMBRE TTS WHEN CONFIGURED</span></div>
            <div className="voice-demo-foot"><span><Radio size={12} /> Continuous conversation available when configured</span><span className="voice-demo-lock"><LockKeyhole size={11} /> Analyst controlled</span></div>
          </div>
        </Reveal>
      </section>

      <section className="home-tech section-wrap" id="technology">
        <Reveal className="section-heading">
          <div className="section-kicker"><span>UNDER THE HOOD</span><i /></div>
          <h2>Built on practical<br /><span>building blocks.</span></h2>
          <p>A focused stack for real-time interaction, structured investigation data, and an analyst-friendly workspace.</p>
        </Reveal>
        <Reveal className="tech-panel" delay={100}>
          <div className="tech-intro"><span className="tech-orbit-icon"><Network size={20} /></span><span><b>Connected by design</b><small>Provider status depends on configuration and successful requests.</small></span></div>
          <div className="tech-grid">
            <div className="tech-item tech-gnani"><span className="tech-symbol"><Waves size={20} /></span><span><small>SPEECH SERVICES</small><b>Gnani AI</b><em>Prisma STT · Timbre TTS</em></span></div>
            <div className="tech-item"><span className="tech-symbol tech-next">N</span><span><small>WEB APPLICATION</small><b>Next.js + React</b><em>Responsive investigation UI</em></span></div>
            <div className="tech-item"><span className="tech-symbol tech-python">Py</span><span><small>APPLICATION API</small><b>Python + FastAPI</b><em>Investigation endpoints</em></span></div>
            <div className="tech-item"><span className="tech-symbol"><Activity size={19} /></span><span><small>REAL-TIME TRANSPORT</small><b>WebSockets</b><em>Voice streaming · live updates</em></span></div>
            <div className="tech-item"><span className="tech-symbol tech-sql">▤</span><span><small>LOCAL PERSISTENCE</small><b>SQLite</b><em>Incident and audit records</em></span></div>
            <div className="tech-item"><span className="tech-symbol"><Sparkles size={19} /></span><span><small>STRUCTURED ANALYSIS</small><b>AI-assisted reasoning</b><em>Configured model or clear dev mode</em></span></div>
          </div>
          <div className="tech-footnote"><span><LockKeyhole size={12} /> API credentials stay server-side.</span><span>Integrations are only shown as connected after verification.</span></div>
        </Reveal>
      </section>

      <section className="home-final-cta">
        <div className="cta-grid" aria-hidden="true" /><div className="cta-glow" aria-hidden="true" />
        <div className="cta-shield" aria-hidden="true"><Shield size={140} strokeWidth={0.7} /><AudioLines size={44} strokeWidth={1} /></div>
        <Reveal className="cta-content">
          <div className="section-kicker"><span>MAKE THE NEXT STEP CLEAR</span><i /></div>
          <h2>Bring clarity to<br /><span>every investigation.</span></h2>
          <p>Explore a more structured, conversational approach to security incident investigation.</p>
          <a className="home-button home-button-primary" href="/dashboard">Launch investigation console <ArrowRight size={16} /></a>
          <span className="cta-caption"><LockKeyhole size={12} /> Start with the workspace. Keep the analyst in control.</span>
        </Reveal>
      </section>

      <footer className="home-footer">
        <div className="footer-main">
          <div className="footer-brand"><a className="home-brand-link" href="#top"><Wordmark /></a><p>An AI-powered investigation workspace for bringing structure and clarity to security incidents.</p><span className="footer-challenge">Built for the Great Indian AI Internship Challenge by Gnani AI.</span></div>
          <div className="footer-nav-group"><span>EXPLORE</span><a href="#product">Product</a><a href="#capabilities">Capabilities</a><a href="#workflow">How it works</a><a href="#technology">Technology</a></div>
          <div className="footer-nav-group"><span>WORKSPACE</span><a href="/dashboard">Investigation console <ArrowRight size={12} /></a><a href="/dashboard#timeline">Incident timeline</a><a href="/dashboard#audit">Investigation history</a></div>
          {(githubUrl || linkedinUrl) && <div className="footer-nav-group"><span>ELSEWHERE</span>{githubUrl && <a href={githubUrl} target="_blank" rel="noreferrer">GitHub <ArrowRight size={12} /></a>}{linkedinUrl && <a href={linkedinUrl} target="_blank" rel="noreferrer">LinkedIn <ArrowRight size={12} /></a>}</div>}
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} VOXSHIELD. All rights reserved.</span><span><span className="footer-status-dot" /> Analyst-led investigation workspace</span></div>
      </footer>
    </main>
  );
}
