import { Children, type ReactElement, type ReactNode, isValidElement, useMemo } from "react";
import { Group, Panel, Separator, useDefaultLayout, type PanelProps } from "react-resizable-panels";
import "./ResizablePanelLayout.css";

export interface ResizablePanelConfig {
    /** Stable id — used for localStorage persistence and internal panel tracking. */
    id: string;
    /** Default size as a percentage of total (0-100). */
    defaultSize: number;
    /** Optional minimum size percentage. Default 10. */
    minSize?: number;
    /** Optional maximum size percentage. */
    maxSize?: number;
    /** Optional collapsible flag. */
    collapsible?: boolean;
    /** Collapsed size in percentage; only used when `collapsible` is true. */
    collapsedSize?: number;
    /** Optional extra className passed to the Panel. */
    className?: string;
}

interface ResizablePanelLayoutProps {
    /**
     * Stable id — used as the localStorage key prefix so each page's layout
     * survives reloads. The `useDefaultLayout` hook rehydrates sizes on mount.
     */
    autoSaveId: string;
    /** "horizontal" for left/right panels, "vertical" for stacked panes. */
    direction?: "horizontal" | "vertical";
    /**
     * Per-panel configuration in the same order as the children passed in.
     * The component zips these with `children` at render time.
     */
    panels: ResizablePanelConfig[];
    /** Children — one React node per panel. Non-element children (e.g. `false`, `null`) are dropped. */
    children: ReactNode;
    className?: string;
}

/**
 * Thin wrapper around `react-resizable-panels` (v4) that standardises handle
 * styling, localStorage persistence, and the common panels-plus-handles pattern
 * we use on Chat, Avatar, and Menu pages.
 *
 * Contract: consumer passes one child per panel in the same order as `panels`.
 * Any falsy child (e.g. from `{flag && <X />}`) is dropped — along with its
 * corresponding panel config, so "collapsed" panels are truly absent from the
 * DOM rather than just hidden.
 */
export default function ResizablePanelLayout({
    autoSaveId,
    direction = "horizontal",
    panels,
    children,
    className,
}: ResizablePanelLayoutProps): JSX.Element {
    const visible = useMemo(() => {
        // Zip panels + children, dropping entries whose child is falsy.
        const childArray = Children.toArray(children);
        const out: Array<{ config: ResizablePanelConfig; child: ReactElement }> = [];
        for (let i = 0; i < childArray.length && i < panels.length; i++) {
            const child = childArray[i];
            if (!isValidElement(child)) continue;
            out.push({ config: panels[i], child });
        }
        return out;
    }, [children, panels]);

    // Rehydrate the layout from localStorage (keyed by autoSaveId + panel ids).
    const panelIds = visible.map((v) => v.config.id);
    const layoutProps = useDefaultLayout({
        id: `resizable-layout-${autoSaveId}`,
        panelIds,
        storage:
            typeof window !== "undefined" && window.localStorage ? window.localStorage : undefined,
    });

    return (
        <Group
            {...layoutProps}
            orientation={direction}
            className={`resizable-layout${className ? ` ${className}` : ""}`}
        >
            {visible.flatMap(({ config, child }, i) => {
                const panelProps: PanelProps = {
                    id: config.id,
                    defaultSize: config.defaultSize,
                    minSize: config.minSize ?? 10,
                    className: config.className,
                };
                if (config.maxSize !== undefined) panelProps.maxSize = config.maxSize;
                if (config.collapsible) {
                    panelProps.collapsible = true;
                    if (config.collapsedSize !== undefined) {
                        panelProps.collapsedSize = config.collapsedSize;
                    }
                }
                // Emit Panel + Separator as flat siblings (no wrapping element).
                // `react-resizable-panels` v4 uses direct-child DOM traversal to pair
                // panels with their neighbouring separators for drag tracking — a
                // wrapping <span style="display: contents"> breaks that pairing even
                // though it's invisible in the box tree, so drags never fire.
                const panel = <Panel key={`${config.id}-panel`} {...panelProps}>{child}</Panel>;
                if (i === visible.length - 1) return [panel];
                const sep = (
                    <Separator
                        key={`${config.id}-sep`}
                        className={`resizable-handle resizable-handle--${direction}`}
                    />
                );
                return [panel, sep];
            })}
        </Group>
    );
}
