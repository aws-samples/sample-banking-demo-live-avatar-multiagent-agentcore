/**
 * A tool call in the avatar transcript, expandable to show what it actually did.
 *
 * The collapsed card only ever said "website_generator Done", which is not much
 * use when the avatar then talks about a link it never showed. Opening the card
 * exposes the arguments and the raw result, so any URL the artifact cards did not
 * recognise is still reachable — and a failed call stops looking identical to a
 * successful one.
 *
 * Uses a native <details>, so keyboard operation and the expanded/collapsed state
 * come from the element rather than being reimplemented with ARIA attributes.
 */

import { Wrench } from "lucide-react";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { displayToolName } from "./toolLabels";

interface ToolCallCardProps {
    toolName: string;
    status: "running" | "done";
    /** Serialised call arguments, when the start event carried them. */
    input?: string;
    /** Raw tool result, when the call has finished. */
    output?: string;
}

/**
 * Pretty-print JSON, or return the text unchanged when it is not JSON.
 *
 * Takes `unknown` rather than `string` on purpose. These values arrive as JSON
 * over the avatar WebSocket, so the declared type is a contract rather than a
 * guarantee: a producer that sent an object here put that object straight into
 * the DOM as a React child, which throws and blanks the whole page.
 */
function format(raw: unknown): string {
    if (typeof raw !== "string") {
        return JSON.stringify(raw, null, 2);
    }
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

/** URLs in the raw result, so an asset stays reachable from the card itself. */
function findUrls(raw: string): string[] {
    // JSON escapes forward slashes in some producers, so match on the escaped
    // form too. Trailing punctuation and quotes are trimmed by the character set.
    const matches = raw.match(/https?:\/\/[^\s"'\\<>)]+/g) ?? [];
    return [...new Set(matches)].slice(0, 5);
}

export default function ToolCallCard({
    toolName,
    status,
    input,
    output,
}: ToolCallCardProps): JSX.Element {
    const hasDetail = Boolean(input || output);
    const inputText = input ? format(input) : undefined;
    const outputText = output ? format(output) : undefined;
    const urls = outputText ? findUrls(outputText) : [];

    const summary = (
        <>
            <Wrench size={14} className="avatar-page__tool-icon" />
            <span className="avatar-page__tool-name">{displayToolName(toolName)}</span>
            <StatusIndicator type={status === "running" ? "in-progress" : "success"}>
                {status === "running" ? "Running" : "Done"}
            </StatusIndicator>
        </>
    );

    // Nothing to reveal yet — render the same card without a disclosure control,
    // so it does not invite a click that does nothing.
    if (!hasDetail) {
        return <div className="avatar-page__tool-card">{summary}</div>;
    }

    return (
        <details className="avatar-page__tool-details">
            <summary className="avatar-page__tool-card avatar-page__tool-card--clickable">
                {summary}
                <span className="avatar-page__tool-hint">details</span>
            </summary>

            <div className="avatar-page__tool-body">
                {urls.length > 0 && (
                    <div className="avatar-page__tool-links">
                        {urls.map((url) => (
                            <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="avatar-page__asset-link"
                            >
                                Open ↗
                            </a>
                        ))}
                    </div>
                )}

                {inputText && (
                    <>
                        <div className="avatar-page__tool-label">Input</div>
                        <pre className="avatar-page__tool-pre">{inputText}</pre>
                    </>
                )}

                {outputText && (
                    <>
                        <div className="avatar-page__tool-label">Result</div>
                        <pre className="avatar-page__tool-pre">{outputText}</pre>
                    </>
                )}
            </div>
        </details>
    );
}
