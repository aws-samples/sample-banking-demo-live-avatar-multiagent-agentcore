import type { ComponentType } from "react";
import { AgentActivityCard } from "./AgentActivityCard";
import { BrowserSessionNotice } from "./BrowserSessionNotice";
import { CatalogQualityReportCard } from "./CatalogQualityReportCard";
import { PdfDeliveryCard } from "./PdfDeliveryCard";
import { PdfDownloadLinkCard } from "./PdfDownloadLinkCard";
import { ResearchPlanCard } from "./ResearchPlanCard";
import { ServicesCatalogCard } from "./ServicesCatalogCard";
import { EvaluationScorecardCard } from "@/components/common/evaluation/EvaluationScorecard";

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
    BrowserSessionNotice,
    CatalogQualityReport: CatalogQualityReportCard,
    PdfDelivery: PdfDeliveryCard,
    PdfDownloadLink: PdfDownloadLinkCard,
    ResearchPlan: ResearchPlanCard,
    ServicesCatalog: ServicesCatalogCard,
    EvaluationScorecard: EvaluationScorecardCard,
};

/** Look up a generative UI component by name. */
export function getUIComponent(name: string): AnyComponent | undefined {
    return UI_COMPONENTS[name];
}
