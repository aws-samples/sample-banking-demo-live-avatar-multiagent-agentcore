import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    Search,
    UtensilsCrossed,
    MessageCircle,
    Mic,
    Layers,
    X,
    FlaskConical,
    BookOpen,
} from "lucide-react";
import Button from "@cloudscape-design/components/button";

const capabilities = [
    {
        icon: FlaskConical,
        title: "Open Research",
        description:
            "Topic-agnostic deep research: ask about any subject and get a structured PDF report with web search, knowledge base retrieval, and AI-generated visuals.",
        service: "Amazon Bedrock AgentCore",
        to: "/research-studio",
    },
    {
        icon: BookOpen,
        title: "Report Archive",
        description:
            "Search across every research report and menu previously generated, using S3 Vectors semantic search.",
        service: "Amazon S3 Vectors",
        to: "/archive",
    },
    {
        icon: Search,
        title: "Bistro Deep Dive",
        description:
            "A four-agent pipeline that decomposes your question, searches web and knowledge bases, synthesizes findings, and delivers a formatted PDF report.",
        service: "Amazon Bedrock AgentCore",
        to: "/research",
    },
    {
        icon: UtensilsCrossed,
        title: "Menu Builder",
        description:
            "Design seasonal menus with AI-generated dish photography, ingredient sourcing, and pricing — exported as print-ready PDFs.",
        service: "Amazon Nova Canvas",
        to: "/menu",
    },
    {
        icon: MessageCircle,
        title: "AI Concierge",
        description:
            "A guardrailed conversational assistant for reservations, wine pairings, dietary accommodations, and daily specials.",
        service: "Amazon Bedrock Guardrails",
        to: "/chat",
    },
    {
        icon: Mic,
        title: "Voice Avatar",
        description:
            "A real-time voice concierge powered by bidirectional audio streaming — speak naturally and hear instant, contextual responses.",
        service: "Amazon Nova Sonic",
        to: "/avatar",
    },
] as const;

export default function HomePage(): JSX.Element {
    const navigate = useNavigate();
    const [showArchitecture, setShowArchitecture] = useState(false);

    return (
        <div className="min-h-screen flex flex-col" style={{ background: "var(--app-bg)" }}>
            {/* Hero */}
            <div className="relative w-full" style={{ height: "60vh", minHeight: 400 }}>
                <img
                    src="/hero-cover.webp"
                    alt="Ocean View Bistro"
                    className="absolute inset-0 w-full h-full object-cover"
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.65) 100%)",
                    }}
                />
                <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-6">
                    <h1
                        className="text-5xl font-bold text-white mb-3 animate-fade-in-up"
                        style={{ textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
                    >
                        Ocean View Bistro
                    </h1>
                    <p
                        className="text-xl text-white/90 mb-4 max-w-xl"
                        style={{ textShadow: "0 1px 6px rgba(0,0,0,0.3)" }}
                    >
                        AI Concierge &mdash; Powered by Amazon Bedrock AgentCore
                    </p>
                    <p
                        className="text-xs tracking-wide text-white/60 mb-8 max-w-lg"
                        style={{ textShadow: "0 1px 4px rgba(0,0,0,0.2)" }}
                    >
                        Updated March 2026 &mdash; Claude Sonnet 4.6 &middot; Nova 2 Sonic &middot;
                        S3 Vectors &middot; AgentCore GA
                    </p>
                    <Button variant="primary" onClick={() => navigate("/research-studio")}>
                        Get Started
                    </Button>
                </div>
            </div>

            {/* Capabilities */}
            <div className="flex-1 px-6 py-12 max-w-5xl mx-auto w-full">
                <h2
                    className="text-2xl font-semibold mb-8 text-center"
                    style={{ color: "var(--app-text)" }}
                >
                    Six AI experiences, one deployment
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {capabilities.map(({ icon: Icon, title, description, service, to }) => (
                        <div
                            key={title}
                            role="button"
                            tabIndex={0}
                            onClick={() => navigate(to)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") navigate(to);
                            }}
                            className="rounded-xl p-5 transition-all cursor-pointer hover:-translate-y-1"
                            style={{
                                background: "var(--glass-bg-strong)",
                                border: "1px solid var(--glass-border)",
                                boxShadow: "var(--card-shadow)",
                            }}
                        >
                            <Icon size={28} style={{ color: "#FF9900" }} className="mb-3" />
                            <h3
                                className="text-base font-semibold mb-2"
                                style={{ color: "var(--app-text)" }}
                            >
                                {title}
                            </h3>
                            <p
                                className="text-sm mb-3"
                                style={{ color: "var(--app-text-secondary)" }}
                            >
                                {description}
                            </p>
                            <span
                                className="inline-block text-xs font-medium px-2 py-0.5 rounded-full"
                                style={{ background: "rgba(255,153,0,0.12)", color: "#FF9900" }}
                            >
                                {service}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Architecture callout */}
                <div className="mt-12 text-center" style={{ color: "var(--app-text-secondary)" }}>
                    <p className="text-sm font-medium mb-1">
                        2 AgentCore Runtimes &middot; 17 Gateway Tools &middot; 3 CDK Stacks
                        &middot; $0 when idle
                    </p>
                    <p
                        className="text-xs"
                        style={{ color: "var(--app-text-tertiary, var(--app-text-secondary))" }}
                    >
                        14 AWS releases (Jul 2025 &ndash; Feb 2026) &middot; Strands Agents &middot;
                        Bedrock Guardrails &middot; Lambda Durable Functions
                    </p>
                </div>
            </div>

            {/* Floating Architecture Button */}
            <button
                onClick={() => setShowArchitecture(true)}
                className="fixed bottom-6 left-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full transition-all hover:scale-105"
                style={{
                    background: "var(--glass-bg-strong)",
                    border: "1px solid var(--glass-border)",
                    boxShadow: "var(--card-shadow)",
                    color: "var(--app-text)",
                }}
            >
                <Layers size={18} style={{ color: "#FF9900" }} />
                <span className="text-sm font-medium">Architecture</span>
            </button>

            {/* Architecture Overlay */}
            {showArchitecture && (
                <div
                    role="dialog"
                    aria-label="Architecture diagram"
                    className="fixed inset-0 z-50 flex items-center justify-center p-6"
                    style={{ background: "rgba(0,0,0,0.75)" }}
                    onClick={() => setShowArchitecture(false)}
                >
                    <div
                        className="relative max-w-6xl w-full max-h-[90vh] overflow-auto rounded-2xl p-6"
                        style={{
                            background: "var(--glass-bg-strong)",
                            border: "1px solid var(--glass-border)",
                            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
                            minWidth: 600,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setShowArchitecture(false)}
                            className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors hover:bg-white/10"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            <X size={20} />
                        </button>
                        <img
                            src="/architecture-diagram.png"
                            alt="Gartner AppDev 2026 Architecture"
                            className="w-full h-auto rounded-lg"
                        />
                        <p
                            className="text-center mt-4 text-xs"
                            style={{ color: "var(--app-text-tertiary, var(--app-text-secondary))" }}
                        >
                            Auto-generated with Claude Opus 4.6 + Python diagrams library
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
