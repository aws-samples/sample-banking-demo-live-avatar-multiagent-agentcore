import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Spinner from "@cloudscape-design/components/spinner";
import Box from "@cloudscape-design/components/box";

interface ReelResultDisplayProps {
    videoUrl?: string;
    status: "pending" | "processing" | "completed" | "failed";
    jobArn?: string;
}

export default function ReelResultDisplay({ videoUrl, status, jobArn }: ReelResultDisplayProps) {
    if (status === "completed" && videoUrl) {
        return (
            <div className="rounded-lg overflow-hidden border border-gray-200">
                <video src={videoUrl} controls className="w-full max-h-64" preload="metadata">
                    Your browser does not support video playback.
                </video>
            </div>
        );
    }

    if (status === "failed") {
        return (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50">
                <StatusIndicator type="error">Video generation failed</StatusIndicator>
                {jobArn && (
                    <Box
                        variant="p"
                        color="text-body-secondary"
                        fontSize="body-s"
                        margin={{ top: "xs" }}
                    >
                        Job: {jobArn}
                    </Box>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 bg-gray-50">
            <Spinner size="normal" />
            <div>
                <StatusIndicator type="in-progress">
                    {status === "pending" ? "Queued for generation" : "Generating video"}
                </StatusIndicator>
                {jobArn && (
                    <Box
                        variant="p"
                        color="text-body-secondary"
                        fontSize="body-s"
                        margin={{ top: "xxs" }}
                    >
                        Job: {jobArn}
                    </Box>
                )}
            </div>
        </div>
    );
}
