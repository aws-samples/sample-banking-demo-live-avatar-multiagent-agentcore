import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Badge from "@cloudscape-design/components/badge";
import { useChatStore } from "@/stores/chatStore";

/**
 * Read-only summary of the generated catalog, shown in the pipeline sidebar.
 *
 * Deliberately has NO controls. Editing, read-aloud, A/B testing and rating all
 * live on the review card in the chat, because they are steps in the
 * conversation — the user acts on them and then approves. Duplicating them here
 * split the flow across two places and let the operator "edit" an item after the
 * export had already been approved, with no effect. This panel exists only as a
 * persistent reference while the conversation continues.
 */
export default function CatalogStudio(): JSX.Element | null {
    const sections = useChatStore((s) => s.menuState.sections);
    if (sections.length === 0) return null;

    const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);

    return (
        <Container
            header={
                <Header
                    variant="h3"
                    description="Review, edit and approve in the chat"
                    counter={`(${itemCount})`}
                >
                    Catalog Summary
                </Header>
            }
        >
            <SpaceBetween size="m" direction="vertical">
                {sections.map((section) => (
                    <div key={section.category}>
                        <Box variant="h4" margin={{ bottom: "xs" }}>
                            {section.category}
                        </Box>
                        <SpaceBetween size="xs" direction="vertical">
                            {section.items.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex items-start gap-2.5 rounded-md p-2"
                                    style={{
                                        border: "1px solid var(--glass-border)",
                                        background: "var(--glass-bg)",
                                    }}
                                >
                                    {item.imageUrl ? (
                                        <img
                                            src={item.imageUrl}
                                            alt={item.name}
                                            className="h-10 w-10 flex-none rounded object-cover"
                                            loading="lazy"
                                        />
                                    ) : null}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span
                                                className="truncate text-[12.5px] font-semibold"
                                                style={{ color: "var(--app-text)" }}
                                            >
                                                {item.name}
                                            </span>
                                            {item.price ? (
                                                <span
                                                    className="shrink-0 text-[10.5px]"
                                                    style={{ color: "var(--app-text-secondary)" }}
                                                >
                                                    {item.price}
                                                </span>
                                            ) : null}
                                        </div>
                                        {item.dietary && item.dietary.length > 0 ? (
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {item.dietary.map((tag) => (
                                                    <Badge key={tag}>{tag}</Badge>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </SpaceBetween>
                    </div>
                ))}
            </SpaceBetween>
        </Container>
    );
}
