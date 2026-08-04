import { ReactNode, useEffect, useState, PropsWithChildren, FormEvent } from "react";
import { useAuth } from "react-oidc-context";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { BRAND, SIGN_IN_HIGHLIGHTS } from "@/config/brand";
import {
    CognitoIdentityProviderClient,
    InitiateAuthCommand,
    RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";

/* ── Cognito direct auth ──────────────────────────────────────── */

const REGION = import.meta.env.VITE_COGNITO_REGION || "us-east-1";
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "";

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

interface AuthTokens {
    idToken: string;
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
}

type SignInResult =
    | { type: "success"; tokens: AuthTokens }
    | { type: "newPasswordRequired"; session: string };

async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
    const response = await cognitoClient.send(
        new InitiateAuthCommand({
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: CLIENT_ID,
            AuthParameters: { USERNAME: email, PASSWORD: password },
        })
    );

    if (response.ChallengeName === "NEW_PASSWORD_REQUIRED") {
        return { type: "newPasswordRequired", session: response.Session! };
    }

    const r = response.AuthenticationResult!;
    return {
        type: "success",
        tokens: {
            idToken: r.IdToken!,
            accessToken: r.AccessToken!,
            refreshToken: r.RefreshToken,
            expiresIn: r.ExpiresIn ?? 3600,
        },
    };
}

async function completeNewPassword(
    email: string,
    newPassword: string,
    session: string
): Promise<AuthTokens> {
    const response = await cognitoClient.send(
        new RespondToAuthChallengeCommand({
            ChallengeName: "NEW_PASSWORD_REQUIRED",
            ClientId: CLIENT_ID,
            ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
            Session: session,
        })
    );
    const r = response.AuthenticationResult!;
    return {
        idToken: r.IdToken!,
        accessToken: r.AccessToken!,
        refreshToken: r.RefreshToken,
        expiresIn: r.ExpiresIn ?? 3600,
    };
}

/** Inject tokens into the OIDC UserManager store so react-oidc-context picks them up. */
function storeOidcUser(tokens: AuthTokens): void {
    const authority = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
    const storageKey = `oidc.user:${authority}:${CLIENT_ID}`;

    const now = Math.floor(Date.now() / 1000);
    const user: Record<string, unknown> = {
        id_token: tokens.idToken,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: "Bearer",
        scope: "email openid profile",
        expires_at: now + tokens.expiresIn,
        profile: JSON.parse(atob(tokens.idToken.split(".")[1])),
    };

    localStorage.setItem(storageKey, JSON.stringify(user));
}

/* ── Market tape ──────────────────────────────────────────────────
   Replaces the previous floating-particle field. Synthetic index values
   drifting in a slow ticker: on-theme for the scenario, keeps the screen
   alive during the recording, and costs one CSS animation rather than
   twelve independently animated nodes. Values are decorative only.
   ─────────────────────────────────────────────────────────────── */

const TAPE = [
    { symbol: "TXSE", value: "4,182.60", delta: "+0.84%", up: true },
    { symbol: "SPX", value: "5,974.12", delta: "+0.31%", up: true },
    { symbol: "NDX", value: "21,486.90", delta: "-0.12%", up: false },
    { symbol: "FTSE", value: "8,412.55", delta: "+0.47%", up: true },
    { symbol: "DAX", value: "19,238.04", delta: "-0.28%", up: false },
    { symbol: "UST10Y", value: "4.118", delta: "+2bp", up: true },
] as const;

function MarketTape(): JSX.Element {
    // Duplicated so the marquee wraps without a visible seam.
    const cells = [...TAPE, ...TAPE];
    return (
        <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden border-t"
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(6,9,13,0.55)" }}
        >
            <div className="flex w-max animate-[tape_38s_linear_infinite] gap-10 px-6 py-2.5">
                {cells.map((c, i) => (
                    <span key={i} className="numeric flex items-baseline gap-2 text-[11px]">
                        <span style={{ color: "rgba(255,255,255,0.55)" }}>{c.symbol}</span>
                        <span style={{ color: "rgba(255,255,255,0.85)" }}>{c.value}</span>
                        <span style={{ color: c.up ? "#34d399" : "#fb7185" }}>{c.delta}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

/* ── Shared backdrop ──────────────────────────────────────────── */

function Backdrop({ children }: PropsWithChildren): JSX.Element {
    return (
        <div
            className="relative flex min-h-screen items-center justify-center overflow-hidden"
            style={{ background: "#06090d" }}
        >
            <style>{`
        @keyframes tape { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[tape_38s_linear_infinite\\] { animation: none !important; }
        }
      `}</style>

            <img
                src="/signin-bg.jpg"
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover opacity-70"
            />
            {/* Deep scrim: pushes the photograph back so the card and the
                brass accent are the only bright elements. */}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(120% 90% at 50% 35%, rgba(6,9,13,0.35) 0%, rgba(6,9,13,0.82) 55%, rgba(6,9,13,0.96) 100%)",
                }}
            />

            {children}
            <MarketTape />
        </div>
    );
}

/* ── Loading state ────────────────────────────────────────────── */

function LoadingState(): JSX.Element {
    return (
        <Backdrop>
            <div className="animate-fade-in-up relative z-10 flex flex-col items-center gap-5">
                <div className="relative">
                    <div
                        className="animate-pulse-ring absolute inset-0 rounded-full"
                        style={{ background: "rgba(200,162,74,0.25)" }}
                    />
                    <img
                        src="/agent-icons/AgentCore.svg"
                        alt="AgentCore"
                        className="relative h-14 w-14"
                    />
                </div>
                <p
                    className="numeric text-[11px] tracking-[0.18em] uppercase"
                    style={{ color: "rgba(255,255,255,0.5)" }}
                >
                    Establishing secure session
                </p>
            </div>
        </Backdrop>
    );
}

/* ── Sign-in card with inline Cognito form ────────────────────── */

type FormMode = "signIn" | "newPassword";

function SignInCard({ onFederateSignIn }: { onFederateSignIn: () => void }): JSX.Element {
    const [mode, setMode] = useState<FormMode>("signIn");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [challengeSession, setChallengeSession] = useState("");

    async function handleSignIn(e: FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const result = await signInWithPassword(email, password);
            if (result.type === "newPasswordRequired") {
                setChallengeSession(result.session);
                setMode("newPassword");
                setPassword("");
            } else {
                storeOidcUser(result.tokens);
                window.location.reload();
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Sign in failed";
            setError(msg);
        } finally {
            setLoading(false);
        }
    }

    async function handleNewPassword(e: FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const tokens = await completeNewPassword(email, newPassword, challengeSession);
            storeOidcUser(tokens);
            window.location.reload();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to set new password";
            setError(msg);
        } finally {
            setLoading(false);
        }
    }

    const inputClass =
        "w-full rounded-[4px] border px-4 py-3 text-[15px] text-white placeholder-white/35 outline-none transition-colors";
    const inputStyle: React.CSSProperties = {
        background: "rgba(255,255,255,0.04)",
        borderColor: "rgba(255,255,255,0.14)",
    };

    return (
        <Backdrop>
            <div
                className="animate-fade-in-up relative z-10 mx-4 flex w-full max-w-[400px] flex-col gap-6 px-9 py-10"
                style={{
                    background: "rgba(18,23,31,0.92)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
                }}
            >
                {/* Wordmark. Hairline above the name reads as a letterhead rule. */}
                <div className="flex flex-col gap-3">
                    <div
                        className="h-[2px] w-10"
                        style={{ background: "var(--brand-accent, #c8a24a)" }}
                    />
                    <div>
                        <h1
                            className="font-display text-[34px] leading-none text-white"
                            style={{ fontFamily: "var(--font-serif, Georgia, serif)" }}
                        >
                            {BRAND.legalName}
                        </h1>
                        <p
                            className="numeric mt-2 text-[10.5px] tracking-[0.16em] uppercase"
                            style={{ color: "rgba(200,162,74,0.9)" }}
                        >
                            {BRAND.descriptor}
                        </p>
                    </div>
                </div>

                {/* Capability chips */}
                <div className="flex flex-wrap gap-1.5">
                    {SIGN_IN_HIGHLIGHTS.map((f) => (
                        <span
                            key={f}
                            className="rounded-[3px] px-2 py-1 text-[10.5px] font-medium tracking-wide"
                            style={{
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.09)",
                                color: "rgba(255,255,255,0.66)",
                            }}
                        >
                            {f}
                        </span>
                    ))}
                </div>

                {/* Error message */}
                {error && (
                    <div
                        role="alert"
                        className="w-full rounded-[4px] px-4 py-2.5 text-sm"
                        style={{
                            background: "rgba(180,41,63,0.14)",
                            border: "1px solid rgba(251,113,133,0.4)",
                            color: "#fda4af",
                        }}
                    >
                        {error}
                    </div>
                )}

                {mode === "signIn" ? (
                    <form onSubmit={handleSignIn} className="flex w-full flex-col gap-3">
                        <label className="sr-only" htmlFor="email">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            required
                            autoComplete="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className={inputClass}
                            style={inputStyle}
                        />

                        <label className="sr-only" htmlFor="password">
                            Password
                        </label>
                        <div className="relative">
                            <input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                required
                                autoComplete="current-password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={inputClass}
                                style={inputStyle}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 transition-colors hover:text-white/80"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                                {showPassword ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </button>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[4px] px-6 py-3 text-[15px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-55"
                            style={{ background: "#c8a24a", color: "#0a0d12" }}
                        >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            Sign In
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleNewPassword} className="flex w-full flex-col gap-3">
                        <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                            Set a new password to continue.
                        </p>

                        <label className="sr-only" htmlFor="newPassword">
                            New Password
                        </label>
                        <div className="relative">
                            <input
                                id="newPassword"
                                type={showNewPassword ? "text" : "password"}
                                required
                                autoComplete="new-password"
                                placeholder="New Password"
                                minLength={8}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className={inputClass}
                                style={inputStyle}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 transition-colors hover:text-white/80"
                                aria-label={showNewPassword ? "Hide password" : "Show password"}
                            >
                                {showNewPassword ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </button>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[4px] px-6 py-3 text-[15px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-55"
                            style={{ background: "#c8a24a", color: "#0a0d12" }}
                        >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            Set Password &amp; Continue
                        </button>
                    </form>
                )}

                {/* Federated sign-in */}
                <button
                    type="button"
                    onClick={onFederateSignIn}
                    className="w-full cursor-pointer rounded-[4px] px-6 py-2.5 text-sm font-medium transition-colors"
                    style={{
                        border: "1px solid rgba(255,255,255,0.14)",
                        color: "rgba(255,255,255,0.72)",
                        background: "transparent",
                    }}
                >
                    Continue with SSO
                </button>

                <div className="rule" style={{ background: "rgba(255,255,255,0.08)" }} />

                {/* Footer: platform attribution + synthetic-data disclosure */}
                <div className="flex flex-col gap-2">
                    <div
                        className="flex items-center gap-2 text-[11px]"
                        style={{ color: "rgba(255,255,255,0.5)" }}
                    >
                        <img
                            src="/agent-icons/AgentCore.svg"
                            alt=""
                            className="h-3.5 w-3.5 opacity-70"
                        />
                        <span>Built on Amazon Bedrock AgentCore</span>
                    </div>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.32)" }}>
                        {BRAND.disclosure} · imagery generated with Amazon Nova Canvas
                    </p>
                </div>
            </div>
        </Backdrop>
    );
}

/* ── Main component ───────────────────────────────────────────── */

function AutoSigninContent({ children }: PropsWithChildren): JSX.Element {
    const auth = useAuth();

    if (auth.isLoading) {
        return <LoadingState />;
    }

    if (!auth.isAuthenticated) {
        const federateProvider = import.meta.env.VITE_COGNITO_IDENTITY_PROVIDER;
        const handleFederateSignIn = () =>
            auth.signinRedirect(
                federateProvider
                    ? { extraQueryParams: { identity_provider: federateProvider } }
                    : undefined
            );
        return <SignInCard onFederateSignIn={handleFederateSignIn} />;
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
