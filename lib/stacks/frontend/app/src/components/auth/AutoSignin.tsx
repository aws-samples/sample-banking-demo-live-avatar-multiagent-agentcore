import { ReactNode, useEffect, useState, useMemo, PropsWithChildren } from "react";
import { useAuth } from "react-oidc-context";
import { Sparkles } from "lucide-react";

/* ── Particle config ──────────────────────────────────────────── */

function randomBetween(a: number, b: number): number {
    return Math.random() * (b - a) + a;
}

interface Particle {
    id: number;
    left: string;
    top: string;
    size: number;
    delay: string;
    duration: string;
    opacity: number;
}

function makeParticles(n: number): Particle[] {
    return Array.from({ length: n }, (_, i) => ({
        id: i,
        left: `${randomBetween(5, 95)}%`,
        top: `${randomBetween(5, 95)}%`,
        size: randomBetween(3, 7),
        delay: `${randomBetween(0, 8).toFixed(1)}s`,
        duration: `${randomBetween(6, 14).toFixed(1)}s`,
        opacity: randomBetween(0.25, 0.6),
    }));
}

/* ── Feature pills ────────────────────────────────────────────── */

const FEATURES = ["Deep Research", "Voice Avatar", "Menu AI", "Concierge Chat"] as const;

/* ── Shared backdrop (background + particles + overlay) ───────── */

function Backdrop({ children }: PropsWithChildren): JSX.Element {
    const particles = useMemo(() => makeParticles(12), []);

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
            {/* Keyframes injected once */}
            <style>{`
        @keyframes float-particle {
          0%, 100% { transform: translateY(0) translateX(0); opacity: var(--p-opacity); }
          25%      { transform: translateY(-18px) translateX(8px); opacity: calc(var(--p-opacity) * 1.2); }
          50%      { transform: translateY(-6px) translateX(-10px); opacity: var(--p-opacity); }
          75%      { transform: translateY(-22px) translateX(5px); opacity: calc(var(--p-opacity) * 0.8); }
        }
        @keyframes glow-btn {
          0%, 100% { box-shadow: 0 0 12px 2px rgba(232, 140, 46, 0.35); }
          50%      { box-shadow: 0 0 28px 6px rgba(232, 140, 46, 0.55); }
        }
      `}</style>

            {/* AI-generated background */}
            <img
                src="/signin-bg.png"
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover"
            />

            {/* Gradient overlay for text contrast */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60" />

            {/* Floating particles */}
            {particles.map((p) => (
                <div
                    key={p.id}
                    className="pointer-events-none absolute rounded-full bg-amber-200/70"
                    style={
                        {
                            left: p.left,
                            top: p.top,
                            width: p.size,
                            height: p.size,
                            "--p-opacity": p.opacity,
                            animationName: "float-particle",
                            animationDuration: p.duration,
                            animationDelay: p.delay,
                            animationTimingFunction: "ease-in-out",
                            animationIterationCount: "infinite",
                        } as React.CSSProperties
                    }
                />
            ))}

            {children}
        </div>
    );
}

/* ── Loading state ────────────────────────────────────────────── */

function LoadingState(): JSX.Element {
    return (
        <Backdrop>
            <div className="relative z-10 flex flex-col items-center gap-4 animate-in fade-in duration-700">
                {/* Pulsing AgentCore icon */}
                <div className="relative">
                    <div className="animate-pulse-ring absolute inset-0 rounded-full bg-amber-400/30" />
                    <img
                        src="/agent-icons/AgentCore.svg"
                        alt="AgentCore"
                        className="relative h-16 w-16 drop-shadow-lg"
                    />
                </div>
                <p className="text-lg font-medium tracking-wide text-white/80">
                    Initializing&hellip;
                </p>
            </div>
        </Backdrop>
    );
}

/* ── Sign-in card ─────────────────────────────────────────────── */

function SignInCard({ onSignIn }: { onSignIn: () => void }): JSX.Element {
    return (
        <Backdrop>
            <div
                className="relative z-10 mx-4 flex w-full max-w-md flex-col items-center gap-6 rounded-2xl px-8 py-10 animate-in fade-in slide-in-from-bottom-4 duration-700"
                style={{
                    background: "var(--glass-bg)",
                    backdropFilter: "var(--glass-blur)",
                    WebkitBackdropFilter: "var(--glass-blur)",
                    border: "1px solid var(--glass-border)",
                    boxShadow: "var(--glass-shadow-lg)",
                }}
            >
                {/* Heading */}
                <div
                    className="flex flex-col items-center gap-1 animate-in fade-in slide-in-from-bottom-3 duration-700"
                    style={{ animationDelay: "100ms", animationFillMode: "backwards" }}
                >
                    <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">
                        Ocean View Bistro
                    </h1>
                    <p className="flex items-center gap-1.5 text-sm font-medium tracking-wide text-amber-200/90">
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Concierge
                    </p>
                </div>

                {/* Feature pills */}
                <div
                    className="flex flex-wrap justify-center gap-2 animate-in fade-in slide-in-from-bottom-3 duration-700"
                    style={{ animationDelay: "200ms", animationFillMode: "backwards" }}
                >
                    {FEATURES.map((f) => (
                        <span
                            key={f}
                            className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium tracking-wide text-amber-100/90"
                        >
                            {f}
                        </span>
                    ))}
                </div>

                {/* Sign-in button */}
                <div
                    className="w-full animate-in fade-in slide-in-from-bottom-3 duration-700"
                    style={{ animationDelay: "300ms", animationFillMode: "backwards" }}
                >
                    <button
                        onClick={onSignIn}
                        className="w-full cursor-pointer rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-base font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
                        style={{ animation: "glow-btn 2.5s ease-in-out infinite" }}
                    >
                        Sign In
                    </button>
                </div>

                {/* Powered-by footer */}
                <div
                    className="flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-3 duration-700"
                    style={{ animationDelay: "400ms", animationFillMode: "backwards" }}
                >
                    <div className="flex items-center gap-2 text-xs text-white/60">
                        <span>Powered by</span>
                        <img
                            src="/agent-icons/AgentCore.svg"
                            alt=""
                            className="h-4 w-4 opacity-70"
                        />
                        <span className="font-medium">Amazon Bedrock AgentCore</span>
                    </div>
                    <p className="text-[10px] italic text-white/40">
                        Background generated with Amazon Nova Canvas
                    </p>
                </div>
            </div>
        </Backdrop>
    );
}

/* ── Main component (preserves existing contract) ─────────────── */

function AutoSigninContent({ children }: PropsWithChildren): JSX.Element {
    const auth = useAuth();

    if (auth.isLoading) {
        return <LoadingState />;
    }

    if (!auth.isAuthenticated) {
        return <SignInCard onSignIn={() => auth.signinRedirect()} />;
    }

    return <>{children}</>;
}

export function AutoSignin({ children }: { children: ReactNode }): JSX.Element | null {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return null;
    }

    return <AutoSigninContent>{children}</AutoSigninContent>;
}
