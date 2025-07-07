/* eslint-disable */
// @ts-nocheck

import { useEffect, useState, useCallback, memo, useRef, createRef, useMemo } from "react";
import {
    ReactFlow,
    Background,
    Controls,
    Edge,
    MarkerType,
    Node,
    useNodesState,
    useEdgesState,
    Handle,
    Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./flow.css";
import {
    Box,
    Button,
    ContentLayout,
    Header,
    SpaceBetween,
    Spinner,
    Icon,
    StatusIndicator,
    Modal,
} from "@cloudscape-design/components";
import Layout from "../../common/components/Layout";
import { fetchWorkflowJson, getWorkflowAssetUrl, useCachedWorkflowAssetUrl } from "../../hooks/useStorage";
import { useCachedMedia } from "../../hooks/useMediaCache";
import { useWorkflowData } from "../../hooks/useWorkflow";

// Define types for our workflow data
interface Action {
    id: string;
    parent_id: string;
    think: string;
    proposed_action?: string;
    screenshot?: string;
    timestamp: number;
    start_time?: number;
    task?: string;
    output?: Record<string, any> | boolean | string;
    active_url?: string;
    type?: string;
    program_body: string;
}


interface WorkflowStep {
    session: string,
    parent_session: string;
    actions: Action[];
    video?: string;
    screenshot?: string;
    start_time: number;
    end_time: number;
    authenticated?: boolean;
    number_actions: number;
    video_duration?: number
}

interface FlowData {
    workflow_steps: WorkflowStep[][];
}

interface NodeData {
    step: WorkflowStep;
    currentTime: number;
    [key: string]: unknown;
}

// Helper function to find current action based on timestamp
const getCurrentAction = (step: WorkflowStep, currentTime: number): Action => {
    return (
        step.actions.reduce((latest: Action | null, action: Action) => {
            if (
                action.start_time &&
                action.start_time <= currentTime &&
                (!latest || (latest.start_time || 0) < (action.start_time || 0))
            ) {
                return action;
            }
            return latest;
        }, null) || step.actions[0]
    );
};

// Helper function to extract PDF filename from URL
const extractPdfName = (url: string): string => {
    if (url.toLowerCase().includes('.pdf')) {
        const urlWithoutQuery = url.split('?')[0];
        const filename = urlWithoutQuery.split('/').pop();
        return filename || url.split('/')[2];
    }
    if (url.includes('ix?doc')) {
        const docMatch = url.match(/doc=([^&]+)/);
        if (docMatch) {
            return docMatch[1].split('/').pop().split('#')[0];
        }
    }
    const urlWithoutQuery = url.split('?')[0].split('#')[0];
    const domain = url.replace(/^https?:\/\//, '').split('/')[0];
    const lastPath = urlWithoutQuery.split('/').pop();
    if (lastPath === 'default.aspx' || lastPath === 'index.html' || lastPath.length > 20 ) {
        return domain
    }
    return `${domain}...${lastPath}`;
};

// Output section component
const OutputSection = ({ action }: { action: Action }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const hasOutput = action?.output && Object.keys(action.output).length > 0;

    if (!hasOutput) return null;

    return (
        <div>
            <div
                className="output-header flex items-center cursor-pointer"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <span className="text-xs text-blue-500 mr-1">{isExpanded ? "(-)" : "(+)"}</span>
                <span className="text-xs font-light text-gray-700">Output</span>
            </div>

            {isExpanded && (
                <div className="output-content mt-2 text-xs bg-gray-50 p-2 rounded overflow-auto max-h-32">
                    {Object.entries(action.output || {}).map(([key, value]) => (
                        <div key={key} className="mb-1">
                            <span className="font-bold">{key}: </span>
                            <span className="text-gray-800">{JSON.stringify(value)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Custom node component to display video and current action
const NodeContent = memo(({ step, currentTime, workflow }: { step: WorkflowStep; currentTime: number; workflow: string }) => {
    const currentAction = getCurrentAction(step, currentTime);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
    const [isVideoVisible, setIsVideoVisible] = useState(false);
    const [videoQuality, setVideoQuality] = useState<'optimized' | 'original'>('optimized');
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Load video URL from S3 with caching (already optimized by parse.py)
    const { data: s3VideoUrl } = useCachedWorkflowAssetUrl(workflow, 'video', step.video || '', !!step.video);
    const { data: cachedVideoUrl } = useCachedMedia(s3VideoUrl);

    // Try thumbnail first, fallback to original screenshot
    const thumbnailName = currentAction.screenshot ? currentAction.screenshot.replace('.jpg', '_thumb.jpg') : '';
    const { data: s3ThumbnailUrl } = useCachedWorkflowAssetUrl(workflow, 'screenshot', thumbnailName, !!currentAction.screenshot);
    const { data: s3ScreenshotUrl } = useCachedWorkflowAssetUrl(workflow, 'screenshot', currentAction.screenshot || '', !!currentAction.screenshot && !s3ThumbnailUrl);

    const { data: cachedThumbnailUrl } = useCachedMedia(s3ThumbnailUrl);
    const { data: cachedScreenshotUrl } = useCachedMedia(s3ScreenshotUrl);

    // Intersection observer for lazy loading
    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVideoVisible(true);
                }
            },
            { threshold: 0.1 }
        );

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (cachedVideoUrl) setVideoUrl(cachedVideoUrl);
    }, [cachedVideoUrl]);

    useEffect(() => {
        // Use thumbnail if available, otherwise fallback to original
        if (cachedThumbnailUrl) {
            setScreenshotUrl(cachedThumbnailUrl);
        } else if (cachedScreenshotUrl) {
            setScreenshotUrl(cachedScreenshotUrl);
        }
    }, [cachedThumbnailUrl, cachedScreenshotUrl]);

    // Sync video time with timeline
    useEffect(() => {
        if (videoRef.current && currentTime >= step.start_time && currentTime <= step.end_time) {
            const videoTime = currentTime - step.start_time;
            if (Math.abs(videoRef.current.currentTime - videoTime) > 1) {
                videoRef.current.currentTime = videoTime;
            }
        }
    }, [currentTime, step.start_time, step.end_time]);

    return (
        <div className={`max-w-xs ${currentAction.type === 'user-input' ? 'node-user-input' : ''}`} ref={containerRef}>
            {/* Authenticated session bar */}
            {step.authenticated && (
                <div className="authenticated-session-bar">authenticated session</div>
            )}
            {/* Task header */}
            {currentAction.active_url && currentAction.active_url !== "" && (
                <div className="task-header">{extractPdfName(currentAction.active_url)}</div>
            )}

            <div className={`session-action-text font-bold mb-2 text-gray-800 mt-2 ${currentAction.type === 'user-input' ? 'node-user-input-text' : ''}`}>
                {/*<div className={"text-xs action-node-pre-header"}>*/}
                {/*    Action {step.actions.findIndex((a) => a.id === currentAction.id) + 1}*/}
                {/*</div>*/}
                {currentAction.think.length > 60
                    ? currentAction.think.substring(0, 60) + "..."
                    : currentAction.think}
            </div>
            {/*<div className="text-xs text-gray-600">*/}
            {/*    {step.actions.length} action{step.actions.length !== 1 ? "s" : ""}*/}
            {/*</div>*/}
            {/*<div className="text-xs text-blue-600 mt-1">Start time: {step.start_time}s</div>*/}
            {/*<div className="text-xs text-green-600">*/}
            {/*    Current action: {step.actions.findIndex((a) => a.id === currentAction.id) + 1} of{" "}*/}
            {/*    {step.actions.length}*/}
            {/*</div>*/}

            <div ref={containerRef}>
                {videoUrl && currentTime <= step.end_time && isVideoVisible ? (
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full mt-2 rounded shadow-sm"
                        muted
                        controls={false}
                        preload="metadata"
                        poster={screenshotUrl || undefined}
                    />
                ) : screenshotUrl ? (
                    <img
                        src={screenshotUrl}
                        alt="Screenshot"
                        className="w-full mt-2 rounded shadow-sm"
                    />
                ) : null}
            </div>
        </div>
    );
});

// Action node component for the side panel
const ActionNode = ({ action, index, currentTime, actions, stepEndTime, actionRef, workflow }: { action: Action; index: number; currentTime: number; actions: Action[], stepEndTime: number, actionRef?: React.RefObject<HTMLDivElement>, workflow: string }) => {
    const [promptExpanded, setPromptExpanded] = useState(false);
    const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
    const [fullScreenshotUrl, setFullScreenshotUrl] = useState<string | null>(null);
    const [modalVisible, setModalVisible] = useState(false);
    const actionTime = action.start_time || action.timestamp;
    const isVisible = actionTime <= currentTime;

    // Try thumbnail first, fallback to original screenshot
    const thumbnailName = action.screenshot ? action.screenshot.replace('.jpg', '_thumb.jpg') : '';
    const { data: s3ThumbnailUrl } = useCachedWorkflowAssetUrl(workflow, 'screenshot', thumbnailName, !!action.screenshot);
    const { data: s3ScreenshotUrl } = useCachedWorkflowAssetUrl(workflow, 'screenshot', action.screenshot || '', !!action.screenshot);

    const { data: cachedThumbnailUrl } = useCachedMedia(s3ThumbnailUrl);
    const { data: cachedFullScreenshotUrl } = useCachedMedia(s3ScreenshotUrl);

    useEffect(() => {
        // Use thumbnail if available, otherwise fallback to original
        if (cachedThumbnailUrl) {
            setScreenshotUrl(cachedThumbnailUrl);
        } else if (cachedFullScreenshotUrl) {
            setScreenshotUrl(cachedFullScreenshotUrl);
        }
        // Store full screenshot for modal
        if (cachedFullScreenshotUrl) {
            setFullScreenshotUrl(cachedFullScreenshotUrl);
        }
    }, [cachedThumbnailUrl, cachedFullScreenshotUrl]);

    // Calculate task duration or current running time
    const nextAction = actions[index + 1];
    const nextActionTime = nextAction ? (nextAction.start_time || nextAction.timestamp) : stepEndTime;
    const isComplete = nextActionTime ? currentTime >= nextActionTime : false;
    const isRunning = isVisible && !isComplete;

    let timeDisplay;
    if (isComplete && nextActionTime) {
        // Show final duration when complete
        timeDisplay = `${nextActionTime - actionTime}s`;
    } else if (isRunning) {
        // Show current running time
        timeDisplay = `${currentTime - actionTime}s`;
    } else {
        // Show start time if not yet started
        timeDisplay = `${actionTime}s`;
    }

    return (
        <>
        <div ref={actionRef} className={`action-node ${isVisible ? 'visible' : 'hidden'} ${action.type === 'user-input' ? 'user-input' : ''}`}>
            <div
                className="action-header cursor-pointer hover:bg-gray-50"
                onClick={() => setModalVisible(true)}
            >
                <div className="action-meta">

                    <span className="task-label">Task {index + 1}</span>
                    <span className="action-time">Run time: {timeDisplay}</span>
                </div>
            </div>

            <div className="action-content">
                {action.task && (
                    <div className="task-header-main">
                        <div
                            className="prompt-toggle cursor-pointer"
                            onClick={() => setPromptExpanded(!promptExpanded)}
                        >

                            <span className="prompt-label"><Icon name={promptExpanded ? 'subtract-minus' : 'add-plus'}/>&nbsp;Prompt</span>
                        </div>
                        {promptExpanded && (
                            <div className="task-text-header">
                                <p>{action.task}</p>
                            </div>
                        )}
                    </div>
                )}
                <div className={`action-text ${action.type === 'script' ? 'user-input-text' : ''}`}>
                    {/*<span className="genai-symbol">🧠 </span>*/}
                    <span className="thinking-label">Nova Act:</span>
                    <p><Icon name={'gen-ai'} variant={'subtle'}/>&nbsp;{action.think}</p>
                    {action.proposed_action && <p><Icon name={'play'} variant={'subtle'}/>&nbsp;{action.proposed_action}</p>}
                </div>
                {screenshotUrl && (
                    <img src={screenshotUrl} alt={`Task ${index + 1}`} className="action-screenshot" />
                )}
                {isComplete && action.output && Object.keys(action.output).length > 0 && (
                    <div className="action-output">
                        <div className="output-label">Output:</div>
                        <pre className="output-data">{JSON.stringify(action.output, null, 2)}</pre>
                    </div>
                )}
            </div>
        </div>

        <Modal
            visible={modalVisible}
            onDismiss={() => setModalVisible(false)}
            header={"Details"}
            size="large"
        >
            <div className="space-y-4">
                {action.task && (
                    <div className="action-content task-header-main task-text-header">
                        <strong>Prompt:</strong>
                        <p className="mt-1">{action.task}</p>
                    </div>
                )}
                <div className={`action-text ${action.type === 'user-input' ? 'user-input-text' : ''}`}>
                    {/*<span className="genai-symbol">🧠 </span>*/}
                    <span className="thinking-label">Nova Act:</span>
                    <p>{action.think}</p>
                </div>
                {fullScreenshotUrl && (
                    <img
                        src={fullScreenshotUrl}
                        alt="Full Screenshot"
                        className="w-full rounded-lg shadow-sm"
                    />
                )}
                {action.active_url && (
                    <div>
                        <strong>Full URL:</strong> {action.active_url}
                    </div>
                )}
                {action.output && Object.keys(action.output).length > 0 && (
                    <div>
                        <strong>Output:</strong>
                        <pre className="mt-2 p-3 bg-gray-50 rounded text-sm overflow-auto max-h-64">
                            {JSON.stringify(action.output, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </Modal>
        </>
    );
};



// Custom node type for workflow steps with click handler
const WorkflowStepNodeWithClick = memo(({ data, isConnectable, onNodeClick, workflow }: { data: NodeData & { isSelected?: boolean }; isConnectable: boolean; onNodeClick: (step: WorkflowStep) => void; workflow: string }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const currentAction = getCurrentAction(data.step, data.currentTime);
    const isSelected = data.isSelected;

    return (
        <div
            className={`bg-white shadow-md rounded-lg border p-0 pb-3 relative cursor-pointer ${
                isSelected ? 'border-blue-500 border-2 selected-node' : 'border-gray-200'
            }`}
            // onMouseEnter={() => setShowTooltip(true)}
            // onMouseLeave={() => setShowTooltip(false)}
            onClick={(e) => {
                e.stopPropagation();
                onNodeClick(data.step);
            }}
        >
            <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
            <NodeContent step={data.step} currentTime={data.currentTime} workflow={workflow} />
            <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />

            {showTooltip && (
                <div className="tooltip">
                    <div className="tooltip-content">
                        <div className="tooltip-title">Full Action:</div>
                        <div className="tooltip-text">{currentAction.think}</div>
                        {currentAction.task && (
                            <>
                                <div className="tooltip-title mt-2">Task:</div>
                                <div className="tooltip-text">{currentAction.task}</div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});

const WorkflowView = ({ workflow = "example_output", status = "NOT_STARTED" }: { workflow?: string; status?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [loading, setLoading] = useState(true);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [flowData, setFlowData] = useState<FlowData | null>(null);
    const [visibleNodes, setVisibleNodes] = useState<string[]>([]);
    const [visibleEdges, setVisibleEdges] = useState<string[]>([]);
    const [maxTime, setMaxTime] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(5);
    const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(false);
    const panelContentRef = useRef<HTMLDivElement>(null);
    const actionRefs = useRef<Record<string, React.RefObject<HTMLDivElement>>>({});

    const handleNodeClick = useCallback((step: WorkflowStep) => {
        setSelectedStep(step);
        setPanelOpen(true);
    }, []);

    const nodeTypes = useMemo(() => ({
        workflowStep: (props: any) => <WorkflowStepNodeWithClick {...props} onNodeClick={handleNodeClick} workflow={workflow} />,
    }), [handleNodeClick, workflow]);

    // Process flow data and create nodes and edges
    const processFlowData = useCallback((data: FlowData) => {
        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];
        let maxEndTime = 0;

        // Track node positions
        let yPosition = 50;
        const xGap = 350;
        const yGap = 350;

        // Flatten all steps and create a session-to-node mapping
        const allSteps: Array<{ step: WorkflowStep; groupIndex: number; stepIndex: number }> = [];
        const sessionToNodeId: Record<string, string> = {};

        data.workflow_steps.forEach((stepGroup, groupIndex) => {
            const groupWidth = stepGroup.length * xGap;
            const startX = 100 - groupWidth / 2;
            const hasNoMedia = stepGroup.some(step => !step.screenshot && !step.video);
            const currentYGap = hasNoMedia ? yGap / 3 : yGap;

            stepGroup.forEach((step, stepIndex) => {
                if (step.end_time > maxEndTime) {
                    maxEndTime = step.end_time;
                }

                const xPosition = startX + stepIndex * xGap;
                const nodeId = `step-${groupIndex}-${stepIndex}`;

                allSteps.push({ step, groupIndex, stepIndex });
                sessionToNodeId[step.session] = nodeId;

                newNodes.push({
                    id: nodeId,
                    type: "workflowStep",
                    position: { x: xPosition, y: yPosition },
                    data: {
                        step,
                        currentTime: 0,
                    },
                    style: {
                        width: 280,
                        opacity: 0,
                        transition: "opacity 0.5s ease-in-out",
                    },
                });
            });

            yPosition += currentYGap;
        });

        // Create edges based on parent_session relationships
        const nodesWithChildren = new Set<string>();

        allSteps.forEach(({ step }) => {
            const currentNodeId = sessionToNodeId[step.session];

            if (step.parent_session && sessionToNodeId[step.parent_session]) {
                const parentNodeId = sessionToNodeId[step.parent_session];
                nodesWithChildren.add(parentNodeId);

                const edgeId = `edge-${step.parent_session}-to-${step.session}`;
                newEdges.push({
                    id: edgeId,
                    source: parentNodeId,
                    target: currentNodeId,
                    type: "smoothstep",
                    animated: false,
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        width: 20,
                        height: 20,
                        color: "#64748b",
                    },
                    style: {
                        strokeWidth: 2,
                        stroke: "#64748b",
                        opacity: 0,
                    },
                });
            }
        });

        // Connect nodes with no children to "end" session if it exists
        const endNodeId = sessionToNodeId["end"];
        if (endNodeId) {
            allSteps.forEach(({ step }) => {
                const nodeId = sessionToNodeId[step.session];
                if (step.session !== "end" && !nodesWithChildren.has(nodeId)) {
                    const edgeId = `edge-${step.session}-to-end`;
                    newEdges.push({
                        id: edgeId,
                        source: nodeId,
                        target: endNodeId,
                        type: "smoothstep",
                        animated: false,
                        markerEnd: {
                            type: MarkerType.ArrowClosed,
                            width: 20,
                            height: 20,
                            color: "#64748b",
                        },
                        style: {
                            strokeWidth: 2,
                            stroke: "#64748b",
                            opacity: 0,
                        },
                    });
                }
            });
        }

        setNodes(newNodes);
        setEdges(newEdges);
        setFlowData(data);
        setMaxTime(maxEndTime);

        // Set initial time based on status
        if (status === "COMPLETE") {
            setCurrentTime(maxEndTime);
            setPlaybackSpeed('5')
        }
    }, []);

    // Use the workflow data hook
    const { data: workflowData, isLoading: workflowLoading, error: workflowError } = useWorkflowData(workflow, true);

    // Process workflow data when it loads
    useEffect(() => {
        if (!workflowLoading) {
            if (workflowData) {
                processFlowData(workflowData);
                setLoading(false);
                if (status === "COMPLETE") {
                    setIsPlaying(true);
                } else {
                    setIsPlaying(true);
                }
            } else {
                setLoading(false);
            }
        }
    }, [workflowData, workflowLoading, processFlowData, status]);

    // Handle loading state
    useEffect(() => {
        setLoading(workflowLoading);
    }, [workflowLoading]);

    // Animation effect
    useEffect(() => {
        if (!isPlaying || !flowData) return;

        const interval = setInterval(() => {
            setCurrentTime((prevTime) => {
                const newTime = prevTime + 1 * playbackSpeed;
                if (newTime > maxTime) {
                    setIsPlaying(false);
                    return maxTime;
                }
                return newTime;
            });
        }, 800);

        return () => clearInterval(interval);
    }, [isPlaying, maxTime, flowData, playbackSpeed]);

    // Update visible nodes and edges based on current time
    useEffect(() => {
        if (!flowData) return;

        const newVisibleNodes: string[] = [];
        const newVisibleEdges: string[] = [];

        // Create session-to-node mapping for visibility checks
        const sessionToNodeId: Record<string, string> = {};
        const visibleSessions = new Set<string>();

        flowData.workflow_steps.forEach((stepGroup, groupIndex) => {
            stepGroup.forEach((step, stepIndex) => {
                const nodeId = `step-${groupIndex}-${stepIndex}`;
                sessionToNodeId[step.session] = nodeId;

                if (step.start_time <= currentTime) {
                    newVisibleNodes.push(nodeId);
                    visibleSessions.add(step.session);
                }
            });
        });

        // Check which edges should be visible based on session relationships
        flowData.workflow_steps.forEach((stepGroup) => {
            stepGroup.forEach((step) => {
                if (visibleSessions.has(step.session)) {
                    // Show edge from parent if both parent and child are visible
                    if (step.parent_session && visibleSessions.has(step.parent_session)) {
                        const edgeId = `edge-${step.parent_session}-to-${step.session}`;
                        newVisibleEdges.push(edgeId);
                    }

                    // Show edge to "end" if this node has no children and "end" is visible
                    if (visibleSessions.has("end")) {
                        const hasChildren = flowData.workflow_steps.some(group =>
                            group.some(childStep => childStep.parent_session === step.session)
                        );
                        if (!hasChildren && step.session !== "end") {
                            const edgeId = `edge-${step.session}-to-end`;
                            newVisibleEdges.push(edgeId);
                        }
                    }
                }
            });
        });

        setVisibleNodes(newVisibleNodes);
        setVisibleEdges(newVisibleEdges);

        // Update node and edge styles
        setNodes((nodes) =>
            nodes.map((node) => ({
                ...node,
                data: {
                    ...node.data,
                    currentTime,
                },
                style: {
                    ...node.style,
                    opacity: newVisibleNodes.includes(node.id) ? 1 : 0,
                },
            }))
        );

        setEdges((edges) =>
            edges.map((edge) => ({
                ...edge,
                style: {
                    ...edge.style,
                    opacity: newVisibleEdges.includes(edge.id) ? 1 : 0,
                },
                animated: newVisibleEdges.includes(edge.id),
            }))
        );
    }, [currentTime, flowData]);

    // Update node selection when selectedStep changes
    useEffect(() => {
        setNodes((nodes) =>
            nodes.map((node) => ({
                ...node,
                data: {
                    ...node.data,
                    isSelected: selectedStep && node.data.step.session === selectedStep.session,
                },
            }))
        );
    }, [selectedStep]);

    // Auto-scroll to latest visible action
    useEffect(() => {
        // if (!selectedStep || !panelOpen) return;
        //
        // const visibleActions = selectedStep.actions.filter(action =>
        //     (action.start_time || action.timestamp) <= currentTime
        // );
        //
        // if (visibleActions.length > 0) {
        //     const latestAction = visibleActions[visibleActions.length - 1];
        //     const actionRef = actionRefs.current[latestAction.id];
        //
        //     if (actionRef?.current && panelContentRef.current) {
        //         actionRef.current.scrollIntoView({
        //             behavior: 'smooth',
        //             block: 'end'
        //         });
        //     }
        // }
    }, [currentTime, selectedStep, panelOpen]);

    // Playback controls
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleReset = () => {
        setIsPlaying(false);
        setCurrentTime(0);
    };

    return (
        <div>
            {loading ? (
                <Box textAlign="center" padding="l">
                    <Spinner size="large" />
                </Box>
            ) : !workflowData ? (
                <Box textAlign="center" padding="l">
                    <StatusIndicator type="error">Workflow data not found</StatusIndicator>
                </Box>
            ) : (
                <SpaceBetween size="m">
                    <SpaceBetween size={'s'} direction={'horizontal'}>
                    <div className="controls-container">
                        <Button
                            variant="icon"
                            iconName="settings"
                            onClick={() => setControlsVisible(!controlsVisible)}
                        />
                    </div>
                    <div className="status-indicator-container">
                        <div
                            className={`status-indicator ${status === "COMPLETE" && currentTime >= maxTime ? "reply" : status === "COMPLETE" ? "replay" : "live"}`}
                        >
                            {status === "COMPLETE" && currentTime >= maxTime ? (
                                <div
                                    onClick={() => {
                                        handleReset();
                                        handlePlay();
                                    }}
                                >
                                    <Icon name="refresh" size="small" /> &nbsp;
                                    <span>Replay</span>
                                </div>
                            ) : status === "COMPLETE" ? (
                                <>
                                    {/*<Icon name="refresh" size="small" />*/}
                                    <span>Replaying...</span>
                                </>
                            ) : (
                                <>
                                    <div className="status-dot" />
                                    <span>Live</span>
                                </>
                            )}
                        </div>
                    </div>
                    </SpaceBetween>
                    {controlsVisible && (
                        <div className="playback-controls flex flex-col p-4 bg-gray-100 rounded-lg">
                            <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center space-x-4">
                                    {isPlaying ? (
                                        <Button onClick={handlePause} variant="primary">
                                            Pause
                                        </Button>
                                    ) : (
                                        <Button onClick={handlePlay} variant="primary">
                                            Play
                                        </Button>
                                    )}
                                    <Button onClick={handleReset} variant="normal">
                                        Reset
                                    </Button>
                                </div>
                                <div className="time-display">
                                    Time: {currentTime}s / {maxTime}s
                                </div>
                                <div className="speed-controls">
                                    <label className="mr-2">Speed:</label>
                                    <select
                                        value={playbackSpeed}
                                        onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                                        className="p-1 border rounded"
                                    >
                                        <option value="0.5">0.5x</option>
                                        <option value="1">1x</option>
                                        <option value="2">2x</option>
                                        <option value="5">5x</option>
                                        <option value="10">10x</option>
                                        <option value="20">20x</option>
                                    </select>
                                </div>
                            </div>
                            <div className="timeline-slider w-full">
                                <input
                                    type="range"
                                    min="0"
                                    max={maxTime}
                                    value={currentTime}
                                    onChange={(e) => {
                                        const newTime = parseInt(e.target.value);
                                        setCurrentTime(newTime);
                                    }}
                                    className="w-full"
                                />
                            </div>
                        </div>
                    )}
                    <div className="flow-container">
                        <div
                            className={`flow-main ${panelOpen ? "panel-open" : ""}`}
                            onClick={() => {
                                setPanelOpen(false);
                                setSelectedStep(null);
                            }}
                        >
                            <ReactFlow
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                nodeTypes={nodeTypes}
                                fitView
                                fitViewOptions={{ padding: 0.2 }}
                                defaultEdgeOptions={{ animated: true }}
                            >
                                <Background color="#f8fafc" />
                                <Controls className="flow-controls" />
                            </ReactFlow>
                        </div>
                        {selectedStep && (
                            <div className={`side-panel ${panelOpen ? "open" : ""}`}>
                                <div className="panel-header">
                                    <h3>Step Details</h3>
                                    <button
                                        onClick={() => {
                                            setPanelOpen(false);
                                            setSelectedStep(null);
                                        }}
                                        className="close-btn"
                                    >
                                        ×
                                    </button>
                                </div>
                                <div className="step-info">
                                    <div className="step-time">
                                        {/*<span>{selectedStep.actions.filter(action => (action.start_time || action.timestamp) <= currentTime).length} of {selectedStep.end_time < currentTime ? selectedStep.actions.length : '?'} actions completed</span>*/}
                                        {selectedStep.end_time <= currentTime ? (
                                            <span>
                                                {
                                                    selectedStep.actions.filter(
                                                        (action) =>
                                                            (action.start_time ||
                                                                action.timestamp) <= currentTime
                                                    ).length
                                                }{" "}
                                                of {selectedStep.actions.length} tasks completed
                                            </span>
                                        ) : (
                                            <span>
                                                Task{" "}
                                                {
                                                    selectedStep.actions.filter(
                                                        (action) =>
                                                            (action.start_time ||
                                                                action.timestamp) <= currentTime
                                                    ).length
                                                }{" "}
                                                in progress
                                            </span>
                                        )}
                                    </div>
                                    <div className="progress-bar">
                                        <div
                                            className="progress-fill"
                                            style={{
                                                width: `${(selectedStep.actions.filter((action) => (action.start_time || action.timestamp) <= currentTime).length / selectedStep.actions.length) * 100}%`,
                                            }}
                                        ></div>
                                    </div>
                                    {/*<div className="progress-text">*/}
                                    {/*    {selectedStep.actions.filter(action => (action.start_time || action.timestamp) <= currentTime).length} of {selectedStep.end_time < currentTime ? selectedStep.actions.length : '?'} actions completed*/}
                                    {/*</div>*/}
                                </div>
                                {selectedStep && (
                                    <div ref={panelContentRef} className="panel-content">
                                        {/*<div className="step-info">*/}
                                        {/*    <div className="step-title">Step Actions ({selectedStep.actions.length})</div>*/}
                                        {/*    <div className="step-time">Duration: {selectedStep.start_time}s - {selectedStep.end_time < currentTime ? `${selectedStep.end_time} s` : ''}</div>*/}
                                        {/*</div>*/}

                                        <div className="actions-list">
                                            {selectedStep.actions.map((action, index) => {
                                                const uniqueKey = `${selectedStep.session}-${action.id}-${index}`;
                                                if (!actionRefs.current[uniqueKey]) {
                                                    actionRefs.current[uniqueKey] = createRef();
                                                }
                                                return (
                                                    <ActionNode
                                                        key={uniqueKey}
                                                        action={action}
                                                        index={index}
                                                        currentTime={currentTime}
                                                        actions={selectedStep.actions}
                                                        stepEndTime={selectedStep.end_time}
                                                        actionRef={actionRefs.current[uniqueKey]}
                                                        workflow={workflow}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </SpaceBetween>
            )}
        </div>
    );
}

export default WorkflowView;
