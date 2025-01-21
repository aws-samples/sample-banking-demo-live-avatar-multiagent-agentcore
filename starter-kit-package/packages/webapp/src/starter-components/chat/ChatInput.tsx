
import { Button, SpaceBetween, Textarea } from "@cloudscape-design/components"
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { addChat, appsyncResolver } from "../../hooks/useApi";
import { authedUserAtom } from "../../atoms/AppAtoms";
import { useAtomValue } from "jotai";

interface ChatInputProps {
    handleScrollToTop: () => void,
    handleScrollToEnd: () => void,
    onSendingChat: (loading: boolean) => void
}
export const ChatInput = (props: ChatInputProps) => {
    const [chatInput, setChatInput] = useState<string>("");
    const authedUser = useAtomValue(authedUserAtom)

    const generateResponseMutation = useMutation({
        mutationFn: (args: string) => appsyncResolver(args),
        onSuccess: ({ data }) => {
            console.log("🚀 ~ CHAT RESPONSE SUCCESS~ :", data)
        },
        onError: (error) => {
            console.log("🚀 ~ CHAT RESPONSE FAILED ~ :", error)
        },
        onSettled: () => {
            props.handleScrollToEnd()
        }
    })

    const createChatMutation = useMutation({
        mutationFn: async () => {
            if (authedUser) {
                return addChat({
                    userID: authedUser.userID,
                    message: chatInput,
                })
            }
        },
        onMutate: () => {
            props.onSendingChat(true)
            props.handleScrollToEnd()
        },
        onSuccess: async (response) => {
            console.log("🚀 ~ CHAT SUCCESS ~ :", response?.data.createChat)
            if (response?.data.createChat) {
                generateResponseMutation.mutate(JSON.stringify({
                    opr: "chat",
                    id: response.data.createChat.id,
                    userID: response.data.createChat.userID,
                    message: chatInput
                }))
            }
        },
        onError: (error) => {
            console.log("🚀 ~ CHAT FAILED ~ :", error)
        },
        onSettled: () => {
            setChatInput("")
            props.onSendingChat(false)

        }
    })

    return (
        <div
            style={{
                display: 'flex', flexDirection: 'row',
                alignContent: 'space-around',
            }}
        >
            <div style={{ flex: 1, padding: 10, alignContent: 'center', alignSelf: 'center' }} >
                <Textarea autoFocus
                    onKeyDown={({ detail }) => {
                        if (detail.key === 'Enter' && !detail.shiftKey) {
                            createChatMutation.mutate()
                        }
                    }}
                    disabled={createChatMutation.isPending}
                    rows={4}
                    placeholder="Type your chat message here - 'Tell me a joke' or 'Summarize these points' or 'What is 2+2?' "
                    spellcheck
                    value={chatInput}
                    onChange={({ detail }) => setChatInput(detail.value)}
                />
            </div>
            <div style={{ padding: 10, alignContent: 'center', alignSelf: 'center', }} >
                {/* <MdSend size={30} color="hsl(167, 98%, 39%)" style={{ cursor: 'pointer', }} onClick={props.onSend} /> */}
                <SpaceBetween size={"s"} direction="horizontal">
                    <Button iconName="angle-up" onClick={() => props.handleScrollToTop()} />
                    <Button iconName="send" loading={createChatMutation.isPending} disabled={chatInput.length < 5} variant="primary" onClick={() => createChatMutation.mutate()
                    } >Send</Button>
                </SpaceBetween>
            </div>
        </div>
    )
}