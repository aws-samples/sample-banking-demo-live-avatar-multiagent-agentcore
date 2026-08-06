import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { Landmark } from "lucide-react";

interface MenuWelcomeScreenProps {
    onExampleClick: (question: string) => void;
}

const EXAMPLE_PROMPTS = [
    {
        title: "Everyday Banking",
        question:
            "Build a services catalog for everyday checking and savings accounts with imagery for each product",
    },
    {
        title: "High-Yield Savings",
        question:
            "Create a services catalog highlighting our High-Yield Savings account at 4.15% APY with an image for each product",
    },
    {
        title: "Retirement Accounts",
        question:
            "Design a services catalog for Traditional and Roth IRAs with imagery for each product",
    },
    {
        title: "Wealth Management",
        question:
            "Build a services catalog for Trinity Managed Portfolios and Private Client wealth management with an image for each product",
    },
];

export default function MenuWelcomeScreen({ onExampleClick }: MenuWelcomeScreenProps): JSX.Element {
    return (
        <div className="flex flex-col items-center max-w-4xl mx-auto py-12 px-4">
            <SpaceBetween size="xl" direction="vertical" alignItems="center">
                <div className="text-center">
                    <div className="flex items-center justify-center gap-3 mb-2">
                        <Landmark size={32} className="text-blue-600" />
                        <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
                            Services Catalog
                        </Box>
                    </div>
                    <Box variant="p" color="text-body-secondary" fontSize="heading-s">
                        Design your services catalog with AI
                    </Box>
                </div>

                <div className="w-full">
                    <Header variant="h2">Try an example prompt</Header>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        {EXAMPLE_PROMPTS.map((item) => (
                            <button
                                key={item.title}
                                type="button"
                                onClick={() => onExampleClick(item.question)}
                                className="text-left cursor-pointer bg-transparent border-0 p-0"
                            >
                                <Container header={<Header variant="h3">{item.title}</Header>}>
                                    <Box variant="p" color="text-body-secondary">
                                        {item.question}
                                    </Box>
                                </Container>
                            </button>
                        ))}
                    </div>
                </div>
            </SpaceBetween>
        </div>
    );
}
