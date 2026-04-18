import type { ComponentType } from "react";
import { AgentActivityCard } from "./AgentActivityCard";
import { PdfDeliveryCard } from "./PdfDeliveryCard";
import { ResearchPlanCard } from "./ResearchPlanCard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

/** Registry mapping generative UI component names to React components.
 *
 * Note: BrowserLiveView is intentionally NOT registered here — it's
 * intercepted upstream in useChatEngine and rendered in a dedicated sidebar
 * via BrowserLiveViewSidebar (backed by useBrowserLiveViewStore).
 */
const UI_COMPONENTS: Record<string, AnyComponent> = {
    AgentActivity: AgentActivityCard,
    PdfDelivery: PdfDeliveryCard,
    ResearchPlan: ResearchPlanCard,
};

/** Look up a generative UI component by name. */
export function getUIComponent(name: string): AnyComponent | undefined {
    return UI_COMPONENTS[name];
}
