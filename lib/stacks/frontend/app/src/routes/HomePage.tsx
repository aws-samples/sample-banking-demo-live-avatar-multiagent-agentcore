import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, X, ArrowRight } from "lucide-react";
import { BRAND, EXPERIENCES } from "@/config/brand";

/** Platform facts shown under the hero. Kept here so the copy has one home. */
const PLATFORM_FACTS = [
    { label: "AgentCore capabilities", value: "11" },
    { label: "Gateway tools", value: "17" },
    { label: "CDK stacks", value: "5" },
    { label: "Idle cost", value: "$0" },
] as const;

export default function HomePage(): JSX.Element {
    const navigate = useNavigate();
    const [showArchitecture, setShowArchitecture] = useState(false);

    return (
        <div className="flex min-h-screen flex-col" style={{ background: "var(--app-bg)" }}>
            {/* ── Hero ───────────────────────────────────────────────── */}
            <div className="relative w-full" style={{ minHeight: 460 }}>
                <img
                    src="/hero-cover.jpg"
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ opacity: 0.55 }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(105deg, rgba(6,9,13,0.96) 0%, rgba(6,9,13,0.82) 45%, rgba(6,9,13,0.55) 100%)",
                    }}
                />

                {/* Left-aligned, editorial. Reads as a report cover rather than
                    a marketing splash. */}
                <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col justify-center px-8 py-20">
                    <div
                        className="animate-fade-in-up mb-6 h-[2px] w-12"
                        style={{ background: "var(--brand-accent)" }}
                    />
                    <p
                        className="numeric animate-fade-in-up mb-4 text-[11px] tracking-[0.2em] uppercase"
                        style={{ color: "rgba(200,162,74,0.9)" }}
                    >
                        {BRAND.tagline} &nbsp;·&nbsp; {BRAND.location}
                    </p>
                    <h1
                        className="font-display animate-fade-in-up mb-5 max-w-3xl text-white"
                        style={{ fontSize: "clamp(2.6rem, 5.4vw, 4.2rem)", lineHeight: 1.04 }}
                    >
                        {BRAND.legalName}
                    </h1>
                    <p
                        className="animate-fade-in-up mb-9 max-w-2xl text-[17px] leading-relaxed"
                        style={{ color: "rgba(255,255,255,0.72)" }}
                    >
                        Six AI experiences on one platform — deep research, product design, client
                        onboarding and live advisory — built on Amazon Bedrock AgentCore with
                        grounding, guardrails, policy and evaluations wired in from the start.
                    </p>

                    <div className="animate-fade-in-up flex flex-wrap items-center gap-3">
                        <button
                            onClick={() => navigate("/research")}
                            className="flex cursor-pointer items-center gap-2 rounded-[4px] px-6 py-3 text-[15px] font-semibold transition-opacity hover:opacity-90"
                            style={{ background: "var(--brand-accent)", color: "#0a0d12" }}
                        >
                            Begin research
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

                {/* Platform facts strip along the base of the hero. */}
                <div
                    className="relative z-10 border-t"
                    style={{
                        borderColor: "rgba(255,255,255,0.1)",
                        background: "rgba(6,9,13,0.6)",
                    }}
                >
                    <dl className="mx-auto flex max-w-6xl flex-wrap gap-x-12 gap-y-3 px-8 py-4">
                        {PLATFORM_FACTS.map(({ label, value }) => (
                            <div key={label} className="flex items-baseline gap-2">
                                <dd
                                    className="numeric text-[15px] font-semibold"
                                    style={{ color: "var(--brand-accent)" }}
                                >
                                    {value}
                                </dd>
                                <dt
                                    className="text-[11px] tracking-wide"
                                    style={{ color: "rgba(255,255,255,0.5)" }}
                                >
                                    {label}
                                </dt>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>

            {/* ── Experience catalog ─────────────────────────────────── */}
            <div className="mx-auto w-full max-w-6xl flex-1 px-8 py-16">
                <div className="mb-10 flex items-end justify-between gap-6">
                    <div>
                        <h2
                            className="font-display text-[26px]"
                            style={{ color: "var(--app-text)" }}
                        >
                            Experiences
                        </h2>
                        <p className="mt-1 text-sm" style={{ color: "var(--app-text-secondary)" }}>
                            Each one exercises a different part of the platform.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-3">
                    {EXPERIENCES.map(({ icon: Icon, label, description, service, to }) => (
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
                                <Icon size={20} style={{ color: "var(--brand-accent)" }} />
                                <ArrowRight
                                    size={15}
                                    className="opacity-0 transition-opacity group-hover:opacity-60"
                                    style={{ color: "var(--app-text-secondary)" }}
                                />
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
                    ))}
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
