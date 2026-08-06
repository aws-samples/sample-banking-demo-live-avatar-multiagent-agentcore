/**
 * Presentational display names for tool chips in the avatar transcript.
 *
 * The gateway tool id is kept as-is for matching, artifact extraction, and the
 * model's own tool calls — only what the viewer reads is remapped. The image
 * tool is still registered as `nova_canvas_generate`, but it now generates with
 * Stability SD3.5 (Amazon Nova Canvas is a legacy model Bedrock refuses in this
 * account), so showing "nova_canvas_generate" on screen misrepresents the tech.
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
    nova_canvas_generate: "stable_diffusion_generate",
};

/** The name to show for a tool in the transcript; falls back to the raw id. */
export function displayToolName(toolName: string): string {
    return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}
