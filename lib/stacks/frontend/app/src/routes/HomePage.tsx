import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, X, ArrowRight } from "lucide-react";
import { BRAND, STAGE_EXPERIENCES, AUDIENCE_META } from "@/config/brand";

/**
 * Landing page.
 *
 * Framing note: Trinity Reserve is a *proposed* bank, not an operating one. The
 * demo starts from a founder's brief and works it up — strategy, services,
 * onboarding agent, advisor. The copy here deliberately says "design"/"proposed"
 * and never implies live accounts or markets, because the earlier version read
 * like an established institution, which it is not.
 */
export default function HomePage(): JSX.Element {
    const navigate = useNavigate();
    const [showArchitecture, setShowArchitecture] = useState(false);

    return (
        <div className="flex min-h-screen flex-col" style={{ background: "var(--app-bg)" }}>
            {/* ── Hero ───────────────────────────────────────────────── */}
            <div className="relative w-full" style={{ minHeight: 420 }}>
                <img
                    src="/hero-cover.jpg"
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ opacity: 0.5 }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(105deg, rgba(6,9,13,0.96) 0%, rgba(6,9,13,0.85) 50%, rgba(6,9,13,0.6) 100%)",
                    }}
                />

                <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col justify-center px-8 py-24">
                    <div
                        className="animate-fade-in-up mb-6 h-[2px] w-12"
                        style={{ background: "var(--brand-accent)" }}
                    />
                    <p
                        className="numeric animate-fade-in-up mb-4 text-[11px] tracking-[0.2em] uppercase"
                        style={{ color: "rgba(200,162,74,0.9)" }}
                    >
                        AI banking blueprint &nbsp;·&nbsp; {BRAND.location}
                    </p>
                    <h1
                        className="font-display animate-fade-in-up mb-5 max-w-3xl text-white"
                        style={{ fontSize: "clamp(2.4rem, 5vw, 3.8rem)", lineHeight: 1.05 }}
                    >
                        Design a bank, from brief to launch plan.
                    </h1>
                    <p
                        className="animate-fade-in-up mb-9 max-w-2xl text-[17px] leading-relaxed"
                        style={{ color: "rgba(255,255,255,0.74)" }}
                    >
                        {BRAND.name} is a <em>proposed</em> bank. Start with a founder&apos;s brief
                        and this platform works it up — a cited strategy, a services catalog, an
                        onboarding agent and a live advisor. Nothing here is a live institution;
                        every customer, account and figure is generated.
                    </p>

                    <div className="animate-fade-in-up flex flex-wrap items-center gap-3">
                        <button
                            onClick={() => navigate("/research")}
                            className="flex cursor-pointer items-center gap-2 rounded-[4px] px-6 py-3 text-[15px] font-semibold transition-opacity hover:opacity-90"
                            style={{ background: "var(--brand-accent)", color: "#0a0d12" }}
                        >
                            Start with a brief
                            <ArrowRight size={16} />
                        </button>
                        <button
                            onClick={() => setShowArchitecture(true)}
                            className="flex cursor-pointer items-center gap-2 rounded-[4px] px-5 py-3 text-[15px] font-medium transition-colors"
                            style={{
                                border: "1px solid rgba(255,255,255,0.16)",
                                color: "rgba(255,255,255,0.8)",
                            }}
                        >
                            <Layers size={16} />
                            Architecture
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Experience catalog ─────────────────────────────────── */}
            <div className="mx-auto w-full max-w-5xl flex-1 px-8 py-16">
                <div className="mb-8">
                    <h2 className="font-display text-[24px]" style={{ color: "var(--app-text)" }}>
                        Four stages, one platform
                    </h2>
                    <p className="mt-1 text-sm" style={{ color: "var(--app-text-secondary)" }}>
                        The first two stages are internal, for employees. The last two are external,
                        for customers, with guardrails and DLP enforced.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-px sm:grid-cols-2">
                    {STAGE_EXPERIENCES.map(
                        ({ icon: Icon, label, description, service, to, audience }, i) => (
                            <div
                                key={to}
                                role="button"
                                tabIndex={0}
                                onClick={() => navigate(to)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") navigate(to);
                                }}
                                className="group flex cursor-pointer flex-col gap-3 p-6 transition-colors"
                                style={{
                                    background: "var(--app-surface)",
                                    outline: "1px solid var(--app-border)",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = "var(--app-surface-raised)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "var(--app-surface)";
                                }}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span
                                            className="numeric text-[11px] tabular-nums"
                                            style={{ color: "var(--app-text-muted)" }}
                                        >
                                            0{i + 1}
                                        </span>
                                        <Icon size={20} style={{ color: "var(--brand-accent)" }} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {/* Audience badge — the brief requires the
                                        platform to serve internal and external
                                        customers with the right guardrails, so
                                        the boundary is stated on every card. */}
                                        <span
                                            className="numeric rounded-full px-2 py-0.5 text-[9.5px] tracking-[0.1em] uppercase"
                                            style={{
                                                color:
                                                    audience === "internal"
                                                        ? "var(--app-text-secondary)"
                                                        : "var(--brand-accent)",
                                                border: "1px solid var(--app-border)",
                                            }}
                                            title={AUDIENCE_META[audience].blurb}
                                        >
                                            {audience === "internal" ? "Internal" : "External"}
                                        </span>
                                        <ArrowRight
                                            size={15}
                                            className="opacity-0 transition-opacity group-hover:opacity-60"
                                            style={{ color: "var(--app-text-secondary)" }}
                                        />
                                    </div>
                                </div>

                                <h3
                                    className="text-[15px] font-semibold"
                                    style={{ color: "var(--app-text)" }}
                                >
                                    {label}
                                </h3>
                                <p
                                    className="flex-1 text-[13px] leading-relaxed"
                                    style={{ color: "var(--app-text-secondary)" }}
                                >
                                    {description}
                                </p>
                                <p
                                    className="numeric text-[10px] tracking-[0.1em] uppercase"
                                    style={{ color: "var(--app-text-muted)" }}
                                >
                                    {service}
                                </p>
                            </div>
                        )
                    )}
                </div>

                <p className="mt-10 text-xs" style={{ color: "var(--app-text-muted)" }}>
                    {BRAND.disclosure}. All customer, account and market data shown in this
                    environment is generated.
                </p>
            </div>

            {/* ── Architecture overlay ───────────────────────────────── */}
            {showArchitecture && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Architecture diagram"
                    className="fixed inset-0 z-50 flex items-center justify-center p-6"
                    style={{ background: "rgba(3,5,8,0.85)" }}
                    onClick={() => setShowArchitecture(false)}
                >
                    <div
                        className="panel-raised relative max-h-[90vh] w-full max-w-6xl overflow-auto p-6"
                        style={{ minWidth: 600 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setShowArchitecture(false)}
                            aria-label="Close architecture diagram"
                            className="absolute top-4 right-4 rounded-[4px] p-1.5 transition-colors"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            <X size={20} />
                        </button>
                        <img
                            src="/architecture-diagram.png"
                            alt={`${BRAND.legalName} platform architecture`}
                            className="h-auto w-full rounded-[4px]"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
