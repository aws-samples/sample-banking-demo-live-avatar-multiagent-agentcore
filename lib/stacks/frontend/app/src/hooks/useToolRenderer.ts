import type { ReactNode } from "react";
import type { ToolCallStatus } from "@/components/chat/types";

export interface ToolRenderProps {
    name: string;
    args: string;
    status: ToolCallStatus;
    result?: string;
}

export type ToolRenderFn = (props: ToolRenderProps) => ReactNode;

const renderers = new Map<string, ToolRenderFn>();

export function useDefaultTool(render: ToolRenderFn): void {
    renderers.set("*", render);
}

export function useToolRenderer(name: string, render: ToolRenderFn): void {
    renderers.set(name, render);
}

export function getToolRenderer(name: string): ToolRenderFn | null {
    // Exact match first
    const exact = renderers.get(name);
    if (exact) return exact;

    // Check for partial match (gateway tool names are prefixed, e.g. gateway_kb-search___kb_search)
    for (const [key, fn] of renderers.entries()) {
        if (key !== "*" && name.includes(key)) return fn;
    }

    return renderers.get("*") ?? null;
}
