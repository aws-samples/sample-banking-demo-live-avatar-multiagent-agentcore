import {
    SERVICE_META,
    describeTool,
    servicesForTools,
    type ServiceMeta,
} from "@/config/toolCatalog";

/**
 * Compact AWS-service chips, and the panel that explains them.
 *
 * Shared by every flow diagram (Deep Research, AI Assistant, AI Agent) so a
 * service reads identically wherever it appears. Chips are colour-coded by
 * plane — teal AgentCore, purple Bedrock models, orange data, pink compute —
 * so the palette itself works as a legend.
 */

interface ServiceChipsProps {
    /** Tool keys whose services should be shown, in call order. */
    tools: string[];
    /** Cap the number of chips; the remainder collapses into a "+N" pill. */
    max?: number;
    /** Chip scale. `xs` is for inside diagram nodes. */
    size?: "xs" | "sm";
    onClick?: () => void;
}

export function ServiceChips({
    tools,
    max = 4,
    size = "xs",
    onClick,
}: ServiceChipsProps): JSX.Element | null {
    const services = servicesForTools(tools);
    if (services.length === 0) return null;

    const shown = services.slice(0, max);
    const overflow = services.length - shown.length;
    const pad = size === "xs" ? "px-1.5 py-[1px] text-[9px]" : "px-2 py-0.5 text-[10px]";

    const content = (
        <div className="flex flex-wrap items-center gap-1">
            {shown.map((service) => (
                <Chip key={service.short} service={service} pad={pad} />
            ))}
            {overflow > 0 && (
                <span
                    className={`rounded-full border border-slate-600/60 text-slate-400 ${pad}`}
                    title={services
                        .slice(max)
                        .map((s) => s.name)
                        .join(", ")}
                >
                    +{overflow}
                </span>
            )}
        </div>
    );

    if (!onClick) return content;

    return (
        <button
            type="button"
            onClick={(e) => {
                // The chips live inside diagram nodes that have their own click
                // and drag handlers; stop propagation so inspecting a service
                // never also selects or drags the node.
                e.stopPropagation();
                onClick();
            }}
            aria-label={`Inspect ${services.length} AWS services used by this step`}
            className="cursor-pointer border-0 bg-transparent p-0 text-left"
        >
            {content}
        </button>
    );
}

function Chip({ service, pad }: { service: ServiceMeta; pad: string }): JSX.Element {
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full font-medium ${pad}`}
            style={{
                color: service.color,
                background: `${service.color}1a`,
                border: `1px solid ${service.color}59`,
            }}
            title={service.name}
        >
            {service.icon && (
                <img src={service.icon} alt="" aria-hidden className="h-2.5 w-2.5 object-contain" />
            )}
            {service.short}
        </span>
    );
}

interface ToolServiceListProps {
    /** Tool key → number of calls. */
    toolCounts: Record<string, number>;
}

/**
 * Expanded breakdown: every tool the step called, what it does, and the AWS
 * services behind it. Rendered inside the inspector panel.
 */
export function ToolServiceList({ toolCounts }: ToolServiceListProps): JSX.Element {
    const entries = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        return (
            <p className="text-xs text-slate-400">
                This step made no tool calls — it reasoned over context it already had.
            </p>
        );
    }

    return (
        <ul className="space-y-3">
            {entries.map(([toolKey, count]) => {
                const tool = describeTool(toolKey);
                return (
                    <li
                        key={toolKey}
                        className="rounded-md border border-slate-700/70 bg-slate-900/50 p-2.5"
                    >
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-100">
                                {tool.label}
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400">
                                {count} {count === 1 ? "call" : "calls"}
                            </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                            {tool.description}
                        </p>
                        {tool.services.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                                {tool.services.map((service) => (
                                    <Chip
                                        key={service.short}
                                        service={service}
                                        pad="px-2 py-0.5 text-[10px]"
                                    />
                                ))}
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/** Colour legend for the chip palette. */
export function ServicePlaneLegend(): JSX.Element {
    const planes = [
        { label: "AgentCore", color: SERVICE_META.agentcore_runtime.color },
        { label: "Bedrock models", color: SERVICE_META.bedrock_claude.color },
        { label: "Data", color: SERVICE_META.s3.color },
        { label: "Compute", color: SERVICE_META.lambda.color },
    ];
    return (
        <div className="flex flex-wrap items-center gap-3">
            {planes.map((plane) => (
                <span
                    key={plane.label}
                    className="inline-flex items-center gap-1.5 text-[10px] text-slate-400"
                >
                    <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ background: plane.color }}
                    />
                    {plane.label}
                </span>
            ))}
        </div>
    );
}
