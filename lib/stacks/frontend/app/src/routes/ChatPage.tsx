import ChatInterface from "@/components/chat/ChatInterface";
import { ChatbotWelcomeScreen } from "@/components/chat/ChatbotWelcomeScreen";
import { SAMPLE_PROMPTS } from "@/config/samplePrompts";

export default function ChatPage(): JSX.Element {
    return (
        <ChatInterface
            mode="chatbot"
            title="AI Agent"
            enableFlowSidebar
            samplePrompts={SAMPLE_PROMPTS.chatbot}
            renderWelcome={(onExampleClick) => (
                <ChatbotWelcomeScreen onExampleClick={onExampleClick} />
            )}
        />
    );
}
