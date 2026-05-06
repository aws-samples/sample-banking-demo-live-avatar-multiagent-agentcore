import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { UtensilsCrossed } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import MenuRecommendationCard from "@/components/restaurant/MenuRecommendationCard";

function ItemCount({ count }: { count: number }): JSX.Element {
    return (
        <StatusIndicator type={count > 0 ? "success" : "pending"}>
            {count} {count === 1 ? "item" : "items"}
        </StatusIndicator>
    );
}

export default function MenuSidePanel(): JSX.Element {
    const state = useChatStore((s) => s.menuState);
    const dispatchMenu = useChatStore((s) => s.dispatchMenu);

    const totalItems = state.sections.reduce((sum, s) => sum + s.items.length, 0);

    const handleClearMenu = (): void => {
        dispatchMenu({ type: "RESET" });
    };

    const handleRemoveItem = (id: string): void => {
        dispatchMenu({ type: "REMOVE_ITEM", id });
    };

    return (
        <div
            className="h-full w-full min-w-0 overflow-y-auto flex flex-col glass-panel-strong"
            style={{ borderLeft: "1px solid var(--glass-border)" }}
        >
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--glass-border)" }}>
                <Header
                    variant="h2"
                    description={<ItemCount count={totalItems} />}
                    actions={
                        totalItems > 0 ? (
                            <Button variant="normal" onClick={handleClearMenu}>
                                Clear all
                            </Button>
                        ) : undefined
                    }
                >
                    <span className="inline-flex items-center gap-2">
                        <UtensilsCrossed size={18} />
                        Menu Builder
                    </span>
                </Header>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {state.sections.length === 0 ? (
                    <Container>
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <UtensilsCrossed
                                size={40}
                                className="mb-4"
                                style={{ color: "var(--app-text-secondary)" }}
                            />
                            <Box variant="h3" color="text-body-secondary">
                                No menu items yet
                            </Box>
                            <Box
                                variant="p"
                                color="text-body-secondary"
                                fontSize="body-s"
                                margin={{ top: "xs" }}
                            >
                                Start building your menu by chatting with the AI concierge
                            </Box>
                        </div>
                    </Container>
                ) : (
                    <SpaceBetween size="l" direction="vertical">
                        {state.sections.map((section) => (
                            <ExpandableSection
                                key={section.category}
                                defaultExpanded
                                variant="container"
                                headerText={section.category}
                                headerCounter={`(${section.items.length})`}
                            >
                                <SpaceBetween size="m" direction="vertical">
                                    {section.items.map((item) => (
                                        <MenuRecommendationCard
                                            key={item.id}
                                            name={item.name}
                                            description={item.description}
                                            price={item.price}
                                            category={item.category}
                                            dietary={item.dietary}
                                            imageUrl={item.imageUrl}
                                            onAddToOrder={() => handleRemoveItem(item.id)}
                                        />
                                    ))}
                                </SpaceBetween>
                            </ExpandableSection>
                        ))}

                        {state.isGenerating && (
                            <Container>
                                <Box textAlign="center" padding="l">
                                    <StatusIndicator type="loading">
                                        Generating menu...
                                    </StatusIndicator>
                                </Box>
                            </Container>
                        )}

                        {state.pdfUrl && (
                            <Container header={<Header variant="h3">Menu PDF</Header>}>
                                <Button
                                    variant="primary"
                                    href={state.pdfUrl}
                                    target="_blank"
                                    iconName="download"
                                >
                                    Download PDF
                                </Button>
                            </Container>
                        )}
                    </SpaceBetween>
                )}
            </div>
        </div>
    );
}
