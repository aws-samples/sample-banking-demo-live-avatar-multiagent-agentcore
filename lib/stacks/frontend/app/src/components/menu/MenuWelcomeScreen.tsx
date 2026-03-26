import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { UtensilsCrossed } from "lucide-react";

interface MenuWelcomeScreenProps {
    onExampleClick: (question: string) => void;
}

const EXAMPLE_PROMPTS = [
    {
        title: "Seasonal Seafood",
        question: "Generate a seasonal seafood menu with 4 courses and a photo for each dish",
    },
    {
        title: "Upscale Dinner",
        question:
            "Create an upscale 4-course dinner menu with wine pairings and generate a photo for each dish",
    },
    {
        title: "Brunch Menu",
        question: "Design a brunch menu with vegetarian options and generate a photo for each dish",
    },
    {
        title: "Prix Fixe Tasting",
        question: "Build a prix fixe tasting menu for 5 courses and generate a photo for each dish",
    },
];

export default function MenuWelcomeScreen({ onExampleClick }: MenuWelcomeScreenProps): JSX.Element {
    return (
        <div className="flex flex-col items-center max-w-4xl mx-auto py-12 px-4">
            <SpaceBetween size="xl" direction="vertical" alignItems="center">
                <div className="text-center">
                    <div className="flex items-center justify-center gap-3 mb-2">
                        <UtensilsCrossed size={32} className="text-blue-600" />
                        <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
                            Menu Builder
                        </Box>
                    </div>
                    <Box variant="p" color="text-body-secondary" fontSize="heading-s">
                        Design your restaurant menu with AI
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
