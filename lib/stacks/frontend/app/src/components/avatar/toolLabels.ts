/**
 * Presentational display names for tool chips in the avatar transcript.
 *
 * Tool ids are now provider-agnostic and capability-based (e.g.
 * `image_generate`), so they read accurately on screen and no remap is needed.
 * Kept as an extension point: add an entry here to override a tool's transcript
 * label without touching its registered gateway id.
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {};

/** The name to show for a tool in the transcript; falls back to the raw id. */
export function displayToolName(toolName: string): string {
    return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}
