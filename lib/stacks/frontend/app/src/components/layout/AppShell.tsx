import { PropsWithChildren, useState, useRef, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
    MessageSquare,
    Mic,
    MessageCircle,
    UtensilsCrossed,
    Sun,
    Moon,
    FlaskConical,
    ChevronDown,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useModelSelector, AVAILABLE_MODELS } from "@/hooks/useModelSelector";
import { resetKnowledgeBase } from "@/services/kbResetService";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import Modal from "@cloudscape-design/components/modal";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Alert from "@cloudscape-design/components/alert";
import Spinner from "@cloudscape-design/components/spinner";

const researchDropdownItems = [
    {
        to: "/research",
        label: "Bistro Deep Dive",
        subtitle: "4-agent pipeline · bistro",
        icon: MessageSquare,
    },
    {
        to: "/research-studio",
        label: "Open Research",
        subtitle: "Any topic · PDF output",
        icon: FlaskConical,
    },
] as const;

const researchPaths = researchDropdownItems.map((i) => i.to) as unknown as string[];

const tabs = [
    {
        to: "/menu",
        label: "Menu Builder",
        subtitle: "Nova Canvas · dish photos",
        icon: UtensilsCrossed,
    },
    {
        to: "/chat",
        label: "AI Concierge",
        subtitle: "Reservations · chat · orders",
        icon: MessageCircle,
    },
    { to: "/avatar", label: "Voice Avatar", subtitle: "Nova Sonic · speak naturally", icon: Mic },
] as const;

export function AppShell({ children }: PropsWithChildren): JSX.Element {
    const { isAuthenticated, signOut, token } = useAuth();
    const { mode, toggleMode } = useTheme();
    const { currentModel, setModelId } = useModelSelector();
    const [logoutVisible, setLogoutVisible] = useState(false);
    const [kbResetVisible, setKbResetVisible] = useState(false);
    const [kbResetLoading, setKbResetLoading] = useState(false);
    const [kbResetResult, setKbResetResult] = useState<{
        type: "success" | "error";
        message: string;
    } | null>(null);
    const [researchOpen, setResearchOpen] = useState(false);
    const researchRef = useRef<HTMLDivElement>(null);
    const location = useLocation();
    const navigate = useNavigate();

    const isResearchActive = researchPaths.includes(location.pathname);
    const activeResearchItem =
        researchDropdownItems.find((i) => i.to === location.pathname) ?? researchDropdownItems[0];

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (researchRef.current && !researchRef.current.contains(e.target as Node)) {
                setResearchOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    return (
        <div className="flex flex-col h-screen">
            <TopNavigation
                identity={{
                    title: "Gartner AppDev 2026",
                    href: "/",
                    logo: { src: "/agent-icons/AgentCore.svg", alt: "AgentCore" },
                }}
                utilities={[
                    {
                        type: "menu-dropdown" as const,
                        text: currentModel.label,
                        description: "Model",
                        items: AVAILABLE_MODELS.map((m) => ({
                            id: m.value,
                            text: m.label,
                            description: m.description,
                        })),
                        onItemClick: (e: { detail: { id: string } }) => setModelId(e.detail.id),
                    },
                    {
                        type: "menu-dropdown" as const,
                        text: "Admin",
                        items: [
                            {
                                id: "reset-kb",
                                text: "Reset Knowledge Base",
                                description: "Clear generated docs and re-index",
                            },
                        ],
                        onItemClick: (e: { detail: { id: string } }) => {
                            if (e.detail.id === "reset-kb") setKbResetVisible(true);
                        },
                    },
                    {
                        type: "button" as const,
                        iconSvg: mode === "dark" ? <Sun size={16} /> : <Moon size={16} />,
                        ariaLabel: mode === "dark" ? "Switch to light mode" : "Switch to dark mode",
                        onClick: toggleMode,
                    },
                    ...(isAuthenticated
                        ? [
                              {
                                  type: "button" as const,
                                  text: "Logout",
                                  onClick: () => setLogoutVisible(true),
                              },
                          ]
                        : []),
                ]}
            />

            {/* Tab navigation */}
            <nav
                className="flex items-center gap-1 px-6 py-2"
                style={{
                    background: "var(--glass-bg-strong)",
                    backdropFilter: "var(--glass-blur)",
                    WebkitBackdropFilter: "var(--glass-blur)",
                    borderBottom: "1px solid var(--glass-border)",
                    boxShadow: "var(--glass-shadow)",
                }}
            >
                {/* Research dropdown tab */}
                <div className="relative" ref={researchRef}>
                    <button
                        onClick={() => {
                            if (!isResearchActive) navigate(activeResearchItem.to);
                            setResearchOpen((o) => !o);
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors"
                        style={{
                            background: isResearchActive
                                ? "var(--app-tab-active-bg)"
                                : "transparent",
                            color: isResearchActive
                                ? "var(--app-tab-active-text)"
                                : "var(--app-tab-inactive-text)",
                        }}
                    >
                        <activeResearchItem.icon size={16} />
                        <div className="flex flex-col leading-tight text-left">
                            <span>{activeResearchItem.label}</span>
                            <span className="text-[10px] opacity-60 font-normal">
                                {activeResearchItem.subtitle}
                            </span>
                        </div>
                        <ChevronDown
                            size={14}
                            className="ml-1 transition-transform"
                            style={{
                                transform: researchOpen ? "rotate(180deg)" : "rotate(0deg)",
                            }}
                        />
                    </button>

                    {researchOpen && (
                        <div
                            className="absolute left-0 top-full mt-1 z-50 min-w-[220px] rounded-lg py-1"
                            style={{
                                background: "var(--glass-bg-strong)",
                                border: "1px solid var(--glass-border)",
                                boxShadow: "var(--card-shadow, 0 4px 12px rgba(0,0,0,0.15))",
                                backdropFilter: "var(--glass-blur)",
                                WebkitBackdropFilter: "var(--glass-blur)",
                            }}
                        >
                            {researchDropdownItems.map(({ to, label, subtitle, icon: Icon }) => (
                                <NavLink
                                    key={to}
                                    to={to}
                                    onClick={() => setResearchOpen(false)}
                                    className="flex items-center gap-2 px-4 py-2 text-sm transition-colors no-underline hover:opacity-80"
                                    style={{
                                        background:
                                            location.pathname === to
                                                ? "var(--app-tab-active-bg)"
                                                : "transparent",
                                        color:
                                            location.pathname === to
                                                ? "var(--app-tab-active-text)"
                                                : "var(--app-tab-inactive-text)",
                                    }}
                                >
                                    <Icon size={16} />
                                    <div className="flex flex-col leading-tight">
                                        <span className="font-medium">{label}</span>
                                        <span className="text-[10px] opacity-60 font-normal">
                                            {subtitle}
                                        </span>
                                    </div>
                                </NavLink>
                            ))}
                        </div>
                    )}
                </div>

                {/* Remaining flat tabs */}
                {tabs.map(({ to, label, subtitle, icon: Icon }) => (
                    <NavLink
                        key={to}
                        to={to}
                        className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors no-underline"
                        style={{
                            background:
                                location.pathname === to
                                    ? "var(--app-tab-active-bg)"
                                    : "transparent",
                            color:
                                location.pathname === to
                                    ? "var(--app-tab-active-text)"
                                    : "var(--app-tab-inactive-text)",
                        }}
                    >
                        <Icon size={16} />
                        <div className="flex flex-col leading-tight">
                            <span>{label}</span>
                            <span className="text-[10px] opacity-60 font-normal">{subtitle}</span>
                        </div>
                    </NavLink>
                ))}
            </nav>

            {/* Logout confirmation modal */}
            <Modal
                visible={logoutVisible}
                onDismiss={() => setLogoutVisible(false)}
                header="Confirm Logout"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={() => setLogoutVisible(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={() => {
                                    setLogoutVisible(false);
                                    signOut();
                                }}
                            >
                                Confirm
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                Are you sure you want to log out?
            </Modal>

            {/* KB Reset confirmation modal */}
            <Modal
                visible={kbResetVisible}
                onDismiss={() => {
                    setKbResetVisible(false);
                    setKbResetResult(null);
                }}
                header="Reset Knowledge Base"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button
                                variant="link"
                                onClick={() => {
                                    setKbResetVisible(false);
                                    setKbResetResult(null);
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                disabled={kbResetLoading || kbResetResult?.type === "success"}
                                onClick={async () => {
                                    if (!token) return;
                                    setKbResetLoading(true);
                                    setKbResetResult(null);
                                    try {
                                        const result = await resetKnowledgeBase(token);
                                        setKbResetResult({
                                            type: "success",
                                            message: `Deleted ${result.deletedCount} generated doc(s). Ingestion job started: ${result.ingestionJobId}`,
                                        });
                                    } catch (err) {
                                        setKbResetResult({
                                            type: "error",
                                            message:
                                                err instanceof Error
                                                    ? err.message
                                                    : "Failed to reset Knowledge Base",
                                        });
                                    } finally {
                                        setKbResetLoading(false);
                                    }
                                }}
                            >
                                {kbResetLoading ? <Spinner /> : "Reset"}
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                <SpaceBetween size="s">
                    <Box>
                        This will delete all generated documents (research reports, menus) from the
                        Knowledge Base and start a fresh re-index from base documents only.
                    </Box>
                    {kbResetResult && (
                        <Alert type={kbResetResult.type}>{kbResetResult.message}</Alert>
                    )}
                </SpaceBetween>
            </Modal>

            {/* Main content */}
            <main className="flex-1 overflow-hidden">{children}</main>
        </div>
    );
}
