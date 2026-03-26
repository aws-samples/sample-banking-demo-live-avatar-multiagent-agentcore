import ChatInterface from "@/components/chat/ChatInterface";
import { ArchiveWelcomeScreen } from "@/components/chat/ArchiveWelcomeScreen";

export default function ArchivePage(): JSX.Element {
    return (
        <ChatInterface
            mode="archive_chat"
            title="Research Archive"
            renderWelcome={(onExampleClick) => (
                <ArchiveWelcomeScreen onExampleClick={onExampleClick} />
            )}
        />
    );
}
