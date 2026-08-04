import { useRef, useState, useCallback, useEffect } from "react";

interface Props {
    url: string;
    onClose: () => void;
}

export default function WebsiteMonitor({ url, onClose }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: 40, y: 20 });
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [dragging, setDragging] = useState(false);
    const [resizing, setResizing] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
    const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

    // Initialize size to 75% of parent
    useEffect(() => {
        const parent = containerRef.current?.parentElement;
        if (parent && size.w === 0) {
            setSize({ w: parent.clientWidth * 0.75, h: parent.clientHeight * 0.7 });
        }
    }, [size.w]);

    const onDragStart = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            setDragging(true);
            dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        },
        [pos]
    );

    const onDragMove = useCallback(
        (e: React.PointerEvent) => {
            if (!dragging) return;
            setPos({
                x: dragStart.current.px + (e.clientX - dragStart.current.x),
                y: dragStart.current.py + (e.clientY - dragStart.current.y),
            });
        },
        [dragging]
    );

    const onDragEnd = useCallback(() => setDragging(false), []);

    const onResizeStart = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setResizing(true);
            resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        },
        [size]
    );

    const onResizeMove = useCallback(
        (e: React.PointerEvent) => {
            if (!resizing) return;
            setSize({
                w: Math.max(280, resizeStart.current.w + (e.clientX - resizeStart.current.x)),
                h: Math.max(200, resizeStart.current.h + (e.clientY - resizeStart.current.y)),
            });
        },
        [resizing]
    );

    const onResizeEnd = useCallback(() => setResizing(false), []);

    return (
        <div
            ref={containerRef}
            className="absolute z-20"
            style={{
                left: pos.x,
                top: pos.y,
                width: size.w || "75%",
                height: size.h || "70%",
            }}
        >
            <div
                className="w-full h-full rounded-2xl overflow-hidden flex flex-col"
                style={{
                    border: "3px solid rgba(0,212,255,0.25)",
                    background: "rgba(5,13,26,0.85)",
                    boxShadow: dragging
                        ? "0 0 80px rgba(0,212,255,0.3)"
                        : "0 0 60px rgba(0,212,255,0.15), inset 0 0 30px rgba(0,0,0,0.5)",
                    transition: dragging ? "none" : "box-shadow 0.3s",
                }}
            >
                {/* Draggable bezel */}
                <div
                    className="flex items-center justify-between px-4 py-2 bg-black/70 border-b border-cyan-500/20 shrink-0"
                    style={{ cursor: "grab", userSelect: "none" }}
                    onPointerDown={onDragStart}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={onDragEnd}
                >
                    <div className="flex gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                        <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
                    </div>
                    <span className="text-[10px] text-cyan-400/50 font-mono truncate mx-4 max-w-[60%]">
                        {url.split("/websites/")[1]?.split("?")[0] || "website"}
                    </span>
                    <div className="flex items-center gap-3">
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-cyan-400/70 hover:text-cyan-300 transition-colors"
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            Open ↗
                        </a>
                        <button
                            onClick={onClose}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="text-gray-500 hover:text-white transition-colors text-sm leading-none"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Iframe */}
                <iframe
                    src={url}
                    title="Generated Website"
                    className="w-full flex-1 border-0 bg-white"
                    style={{ pointerEvents: dragging || resizing ? "none" : "auto" }}
                    sandbox="allow-scripts allow-same-origin"
                />
            </div>

            {/* Resize handle (bottom-right corner) */}
            <div
                className="absolute bottom-0 right-0 w-6 h-6 flex items-end justify-end"
                style={{ cursor: "nwse-resize" }}
                onPointerDown={onResizeStart}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeEnd}
                onPointerCancel={onResizeEnd}
            >
                <svg width="12" height="12" viewBox="0 0 12 12" className="opacity-50">
                    <path
                        d="M11 1v10H1"
                        fill="none"
                        stroke="rgba(0,212,255,0.6)"
                        strokeWidth="1.5"
                    />
                    <path
                        d="M11 5v6H5"
                        fill="none"
                        stroke="rgba(0,212,255,0.4)"
                        strokeWidth="1.5"
                    />
                    <path
                        d="M11 9v2H9"
                        fill="none"
                        stroke="rgba(0,212,255,0.3)"
                        strokeWidth="1.5"
                    />
                </svg>
            </div>
        </div>
    );
}
