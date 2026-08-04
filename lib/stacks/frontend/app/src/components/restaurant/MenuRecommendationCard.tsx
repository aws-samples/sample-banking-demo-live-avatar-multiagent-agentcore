import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import { BRAND } from "@/config/brand";

interface MenuRecommendationCardProps {
    name: string;
    description: string;
    price: string;
    category: string;
    dietary?: string[];
    imageUrl?: string;
    onAddToOrder?: () => void;
    editable?: boolean;
}

const DIETARY_COLORS: Record<string, string> = {
    GF: "bg-amber-100 text-amber-800",
    V: "bg-green-100 text-green-800",
    VG: "bg-emerald-100 text-emerald-800",
};

export default function MenuRecommendationCard({
    name,
    description,
    price,
    category,
    dietary,
    imageUrl,
    onAddToOrder,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    editable: _editable,
}: MenuRecommendationCardProps) {
    return (
        <Container
            header={
                <Header
                    variant="h3"
                    description={category}
                    actions={
                        <SpaceBetween size="xs" direction="horizontal" alignItems="center">
                            <Box fontSize="heading-m" fontWeight="bold" color="text-status-info">
                                {price}
                            </Box>
                            {onAddToOrder && (
                                <Button variant="inline-link" onClick={onAddToOrder}>
                                    Add
                                </Button>
                            )}
                        </SpaceBetween>
                    }
                >
                    <span style={{ color: "var(--brand-accent)" }}>{name}</span>
                </Header>
            }
        >
            <SpaceBetween size="s" direction="vertical">
                {imageUrl && (
                    <img
                        src={imageUrl}
                        alt={name}
                        className="w-full h-40 object-cover rounded-lg"
                        loading="lazy"
                    />
                )}
                <Box variant="p">{description}</Box>
                {dietary && dietary.length > 0 && (
                    <div className="flex gap-2">
                        {dietary.map((tag) => (
                            <span
                                key={tag}
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${DIETARY_COLORS[tag] ?? ""}`}
                                style={
                                    DIETARY_COLORS[tag]
                                        ? undefined
                                        : {
                                              background: "var(--app-bg-alt)",
                                              color: "var(--app-text)",
                                          }
                                }
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
                <Box variant="p" color="text-body-secondary" fontSize="body-s">
                    {BRAND.legalName}
                </Box>
            </SpaceBetween>
        </Container>
    );
}
