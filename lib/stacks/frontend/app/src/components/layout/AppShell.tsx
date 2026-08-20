import { PropsWithChildren, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Sun, Moon, Info } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useModelSelector, AVAILABLE_MODELS } from "@/hooks/useModelSelector";
import { resetKnowledgeBase } from "@/services/kbResetService";
import {
    BRAND,
    AUDIENCE_META,
    AUDIENCE_ORDER,
    EXPERIENCES,
    experiencesByAudience,
    type Experience,
} from "@/config/brand";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import Modal from "@cloudscape-design/components/modal";
import Popover from "@cloudscape-design/components/popover";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Alert from "@cloudscape-design/components/alert";
import Spinner from "@cloudscape-design/components/spinner";

/**
 * Vertical navigation rail.
 *
 * Experiences are grouped under "Internal · Employees" and
 * "External · Customers" headers, because the brief requires the platform to
 * serve both audiences with the appropriate guardrails — the grouping makes
 * that boundary (and the guardrail posture that follows from it) visible.
 * Each row carries a subtitle for at-a-glance context and an info icon that
 * opens a popover with the full description on click, so the rail stays
 * compact but every experience is self-documenting.
 */
function NavRail(): JSX.Element {
    const location = useLocation();

    /**
     * Shared markup for a single rail row (link + info popover). Used both by
     * the audience-grouped rows and by the "Latest Reports" utility row pinned
     * to the bottom of the rail.
     */
    const renderItem = ({
        to,
        label: itemLabel,
        subtitle,
        description,
        icon: Icon,
    }: Experience): JSX.Element => {
        const active = location.pathname === to;
        return (
            <div key={to} className="group relative flex items-stretch">
                <NavLink
                    to={to}
                    aria-current={active ? "page" : undefined}
                    className="relative flex min-w-0 flex-1 items-start gap-2.5 rounded-[4px] px-3 py-2 no-underline transition-colors"
                    style={{
                        background: active ? "var(--app-nav-item-active-bg)" : "transparent",
                        color: active
                            ? "var(--app-nav-item-active-text)"
                            : "var(--app-nav-item-text)",
                    }}
                >
                    {/* Brass indicator on the active item. */}
                    <span
                        aria-hidden
                        className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full transition-opacity"
                        style={{
                            background: "var(--brand-accent)",
                            opacity: active ? 1 : 0,
                        }}
                    />
                    <Icon
                        size={15}
                        className="mt-0.5 shrink-0"
                        style={{
                            color: active ? "var(--brand-accent)" : undefined,
                        }}
                    />
                    <span className="flex min-w-0 flex-col leading-tight">
                        <span className="text-[13px] font-medium">{itemLabel}</span>
                        <span
                            className="truncate text-[10.5px]"
                            style={{ color: "var(--app-text-muted)" }}
                        >
                            {subtitle}
                        </span>
                    </span>
                </NavLink>

                {/* Info icon — click to open a popover with the full description.
                    Sits outside the NavLink so clicking it doesn't route away. */}
                <span
                    className="flex shrink-0 items-start pt-2.5 pr-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Popover
                        dismissButton={false}
                        position="right"
                        size="medium"
                        triggerType="custom"
                        header={itemLabel}
                        content={
                            <Box variant="p" fontSize="body-s">
                                {description}
                            </Box>
                        }
                    >
                        <button
                            type="button"
                            aria-label={`About ${itemLabel}`}
                            className="flex h-5 w-5 items-center justify-center rounded-full border-0 bg-transparent p-0 opacity-60 transition-opacity hover:opacity-100"
                            style={{
                                color: "var(--app-text-muted)",
                                cursor: "pointer",
                            }}
                        >
                            <Info size={13} />
                        </button>
                    </Popover>
                </span>
            </div>
        );
    };

    // Utility/supporting views (e.g. Latest Reports) are pinned to the bottom
    // of the rail rather than shown inside an audience group.
    const secondaryItems = EXPERIENCES.filter((e) => e.secondary);

    return (
        <nav
            aria-label="Primary"
            className="flex w-[232px] shrink-0 flex-col gap-1 overflow-y-auto px-3 py-5"
            style={{
                background: "var(--app-nav-bg)",
                borderRight: "1px solid var(--app-border)",
            }}
        >
            {AUDIENCE_ORDER.flatMap((audience) => {
                const items = experiencesByAudience(audience).filter((e) => !e.secondary);
                if (items.length === 0) return [];
                const meta = AUDIENCE_META[audience];
                return [
                    <p
                        key={`hdr-${audience}`}
                        className="numeric px-3 pt-3 pb-2 text-[9.5px] tracking-[0.16em] uppercase first:pt-0"
                        style={{ color: "var(--app-text-muted)" }}
                        title={meta.blurb}
                    >
                        {meta.label}
                    </p>,
                    ...items.map(renderItem),
                ];
            })}

            <div className="mt-auto">
                {secondaryItems.map(renderItem)}
                <div className="px-3">
                    <div className="rule mt-2 mb-3" />
                    <p className="text-[10px]" style={{ color: "var(--app-text-muted)" }}>
                        {BRAND.disclosure}
                    </p>
                </div>
            </div>
        </nav>
    );
}

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

    return (
        <div className="flex h-screen flex-col">
            <TopNavigation
                identity={{
                    title: BRAND.legalName,
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
                                  text: "Sign out",
                                  onClick: () => setLogoutVisible(true),
                              },
                          ]
                        : []),
                ]}
            />

            {/* Logout confirmation modal */}
            <Modal
                visible={logoutVisible}
                onDismiss={() => setLogoutVisible(false)}
                header="Confirm sign out"
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
                Are you sure you want to sign out?
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
                        This will delete all generated documents (research reports and disclosure
                        documents) from the Knowledge Base and start a fresh re-index from base
                        documents only.
                    </Box>
                    {kbResetResult && (
                        <Alert type={kbResetResult.type}>{kbResetResult.message}</Alert>
                    )}
                </SpaceBetween>
            </Modal>

            {/* Rail + content */}
            <div className="flex flex-1 overflow-hidden">
                <NavRail />
                <main className="flex-1 overflow-hidden">{children}</main>
            </div>
        </div>
    );
}
