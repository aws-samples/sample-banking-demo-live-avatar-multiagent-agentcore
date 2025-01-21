import { Box, ContentLayout, Spinner } from "@cloudscape-design/components";
import { useRef, useState } from "react";
import { ChatInput } from "../starter-components/chat/ChatInput";
import { ChatMessages } from "../starter-components/chat/ChatMessages";

export const Chat = () => {
    // use ref
    const top = useRef<null | HTMLDivElement>(null);
    const el = useRef<null | HTMLDivElement>(null);
    const [sendingChat, setSendingChat] = useState(false)

    const scrollToTop = () => {
        console.log("top");

        if (top.current) {
            top.current.focus()
            top.current.scrollIntoView({ behavior: "auto", block: "end" })
            top.current.lastElementChild?.scrollIntoView({ behavior: "auto", block: "end" })
        }
    }

    const scrollToEnd = () => {
        if (el.current) {
            el.current.focus()
            el.current.scrollIntoView({ behavior: "auto", block: "end" })
            el.current.lastElementChild?.scrollIntoView({ behavior: "auto", block: "end" })
        }
    }

    return (
        <ContentLayout >
            <div
                style={{
                    maxHeight: '80vh',
                    minHeight: '75vh',
                    display: 'flex',
                    flex: 1,
                    flexDirection: 'column',
                    overflow: 'auto',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'transparent transparent',
                }}>
                <div ref={top}></div>
                <ChatMessages handleScrollToEnd={scrollToEnd} />
                {sendingChat ?? <Spinner />}
                <div ref={el}>                </div>
            </div>
            <div style={{
                display: 'flex', flex: 1,
                color: "#00a4ef",
                justifyContent: 'center',
            }}>

            </div>
            <Box padding={{
                top: 'm'
            }}>
                <ChatInput handleScrollToTop={scrollToTop} handleScrollToEnd={scrollToEnd} onSendingChat={(status: boolean) => setSendingChat(status)} />
            </Box>
        </ContentLayout>

    )
}