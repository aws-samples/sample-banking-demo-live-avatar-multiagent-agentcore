import { ReactNode, useEffect, useState, useMemo, PropsWithChildren, FormEvent } from "react";
import { useAuth } from "react-oidc-context";
import { Sparkles, Eye, EyeOff, Loader2 } from "lucide-react";
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

const FEATURES = ["Deep Research", "Voice Avatar", "Menu AI", "Concierge Chat"] as const;

/* ── Shared backdrop ──────────────────────────────────────────── */

function Backdrop({ children }: PropsWithChildren): JSX.Element {
    const particles = useMemo(() => makeParticles(12), []);

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
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

            <img
                src="/signin-bg.png"
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60" />

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
        "w-full rounded-xl border border-amber-400/30 bg-white/10 px-4 py-3 text-white placeholder-white/50 outline-none backdrop-blur-sm transition-colors focus:border-amber-400/60 focus:bg-white/15";

    return (
        <Backdrop>
            <div
                className="relative z-10 mx-4 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl px-8 py-10 animate-in fade-in slide-in-from-bottom-4 duration-700"
                style={{
                    background: "var(--glass-bg)",
                    backdropFilter: "var(--glass-blur)",
                    WebkitBackdropFilter: "var(--glass-blur)",
                    border: "1px solid var(--glass-border)",
                    boxShadow: "var(--glass-shadow-lg)",
                }}
            >
                {/* Heading */}
                <div className="flex flex-col items-center gap-1">
                    <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">
                        Ocean View Bistro
                    </h1>
                    <p className="flex items-center gap-1.5 text-sm font-medium tracking-wide text-amber-200/90">
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Concierge
                    </p>
                </div>

                {/* Feature pills */}
                <div className="flex flex-wrap justify-center gap-2">
                    {FEATURES.map((f) => (
                        <span
                            key={f}
                            className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium tracking-wide text-amber-100/90"
                        >
                            {f}
                        </span>
                    ))}
                </div>

                {/* Error message */}
                {error && (
                    <div className="w-full rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-2.5 text-sm text-red-200">
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
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/80"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                                {showPassword ? (
                                    <EyeOff className="h-4.5 w-4.5" />
                                ) : (
                                    <Eye className="h-4.5 w-4.5" />
                                )}
                            </button>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-base font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
                            style={
                                loading
                                    ? undefined
                                    : { animation: "glow-btn 2.5s ease-in-out infinite" }
                            }
                        >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            Sign In
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleNewPassword} className="flex w-full flex-col gap-3">
                        <p className="text-center text-sm text-amber-200/80">
                            Please set a new password to continue.
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
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/80"
                                aria-label={showNewPassword ? "Hide password" : "Show password"}
                            >
                                {showNewPassword ? (
                                    <EyeOff className="h-4.5 w-4.5" />
                                ) : (
                                    <Eye className="h-4.5 w-4.5" />
                                )}
                            </button>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-base font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
                        >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            Set Password & Continue
                        </button>
                    </form>
                )}

                {/* Federate sign-in option */}
                <button
                    type="button"
                    onClick={onFederateSignIn}
                    className="w-full cursor-pointer rounded-xl border border-amber-400/30 bg-white/5 px-6 py-2.5 text-sm font-medium text-amber-100/80 transition-colors hover:bg-white/10"
                >
                    Sign in with SSO
                </button>

                {/* Powered-by footer */}
                <div className="flex flex-col items-center gap-2">
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

/* ── Main component ───────────────────────────────────────────── */

function AutoSigninContent({ children }: PropsWithChildren): JSX.Element {
    const auth = useAuth();

    if (auth.isLoading) {
        return <LoadingState />;
    }

    if (!auth.isAuthenticated) {
        return <SignInCard onFederateSignIn={() => auth.signinRedirect()} />;
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
