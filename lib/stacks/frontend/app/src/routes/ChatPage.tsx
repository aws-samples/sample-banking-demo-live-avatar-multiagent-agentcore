import ChatInterface from "@/components/chat/ChatInterface";
import { ChatbotWelcomeScreen } from "@/components/chat/ChatbotWelcomeScreen";

export default function ChatPage(): JSX.Element {
    return (
        <ChatInterface
            mode="chatbot"
            title="AI Concierge"
            enableFlowSidebar
            renderWelcome={(onExampleClick) => (
                <ChatbotWelcomeScreen onExampleClick={onExampleClick} />
            )}
        />
    );
}
