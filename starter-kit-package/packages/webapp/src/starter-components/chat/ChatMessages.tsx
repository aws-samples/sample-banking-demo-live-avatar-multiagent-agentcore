import { Container, Box, SpaceBetween, Button, Spinner, Header } from "@cloudscape-design/components"
import { useAtomValue } from "jotai"
import { removeChat, useListChatsByUser } from "../../hooks/useApi"
import { authedUserAtom } from "../../atoms/AppAtoms"
import { BsFilePersonFill } from "react-icons/bs";
import { RiRobot2Line } from "react-icons/ri";
import { useCallback, useEffect, useState } from "react";
import { generateClient } from "aws-amplify/api";
import { onChatByUserId } from "../../graphql/subscriptions";
import { useMutation } from "@tanstack/react-query";

interface ChatMessagesProps {
    handleScrollToEnd: () => void
}

export const ChatMessages = (props: ChatMessagesProps) => {
    // amplify
    const client = generateClient();
    const authedUser = useAtomValue(authedUserAtom)
    const { data: chats, isLoading, refetch, isFetched } = useListChatsByUser(authedUser?.userID ?? "")

    const deleteChatMutation = useMutation({
        mutationFn: (id: string) => removeChat(id),
    })

    const sub = useCallback(() => {
        console.log("Subscribing for Update Chat responses -->", chats);

        const createSub = client
            .graphql({
                query: onChatByUserId, variables: {
                    userID: authedUser?.userID ?? "",
                }
            })
            .subscribe({
                next: ({ data }) => {
                    console.log("🚀 ~ SUBS ~ onUpdateChat:", data.onChatByUserId)
                    // this will query GQL again and very inefficient 
                    // try to useMemo() for more optimized update to last message
                    refetch()
                    props.handleScrollToEnd()
                },
                error: (error) => console.warn(error),
                complete: () => console.log("complete"),
            });

        return createSub

    }, [])

    useEffect(() => {
        console.log("Subscribing for Update Chat responses -->");
        const subscription = sub();
        return () => {
            if (subscription) {
                console.log("UNsubscribing for Update Chat responses <--");
                subscription.unsubscribe()
            }
        }
    }, [])

    useEffect(() => {
        props.handleScrollToEnd()
    }, [isFetched])

    const deleteChats = () => {
        if (!chats)
            return

        chats.forEach(chat => {
            deleteChatMutation.mutate(chat.id, {
                onSuccess: (data) => {
                    console.log("🚀 ~ deleteChats ~ data:", data)

                },
                onError: (error) => {
                    console.log("🚀 ~ deleteChats ~ error:", error)

                },
                onSettled: () => {
                    refetch()
                }
            })
        });
    }
    return (
        <Container header={<Header
            variant="h1"
            description="A simple chatbot demo powered by Amazon AppSync real-time subscriptions."
            actions={<SpaceBetween direction="horizontal" size="m">
                <Button iconName="angle-down" onClick={() => props.handleScrollToEnd()}>Scroll to End</Button>
                <Button iconName="refresh" onClick={() => refetch()}>Refresh</Button>
                <Button iconName="delete-marker" onClick={deleteChats}>Clear Chats</Button>
            </SpaceBetween>}
        >
            Gen-AI Chatbot
        </Header>}>
            {chats && chats.length > 0 ? chats.map((chat, index) =>
                <div key={chat.id + index} >
                    <div
                        style={{
                            display: 'flex', flexDirection: 'row',
                            alignContent: 'space-around', padding: 10,
                        }}
                    >
                        <div style={{
                            flex: 1, padding: 10, alignContent: 'center', alignSelf: 'center',
                            marginLeft: "40%",
                            marginRight: 0,
                        }} >

                            <Container >
                                {chat.human}
                            </Container>


                        </div>
                        <div style={{ padding: 10, alignContent: 'center', alignSelf: 'center', }} >
                            <BsFilePersonFill size={30} color="#00a4ef" style={{ cursor: 'pointer' }} />
                        </div>
                    </div>
                    {chat.bot && chat.bot.length > 0 &&
                        <div
                            style={{
                                display: 'flex', flexDirection: 'row-reverse',
                                alignContent: 'space-around', padding: 10,
                            }}
                        >
                            <div style={{
                                flex: 1, padding: 10, alignContent: 'center', alignSelf: 'center',
                                marginLeft: "0",
                                marginRight: "40%",

                            }} >
                                <Container key={chat.id + index}
                                >
                                    {chat.bot}
                                </Container>
                            </div>
                            <div style={{ padding: 10, alignContent: 'center', alignSelf: 'center', }} >
                                <RiRobot2Line size={30} color="#00a4ef" style={{ cursor: 'pointer' }} />
                            </div>
                        </div>}
                </div>) : <Box
                    margin={{ vertical: "xs" }}
                    textAlign="center"
                    color="inherit"
                >
                <SpaceBetween size="m">
                    {isLoading ? <Spinner /> : <Box variant="h5" padding={{
                        top: 'l',
                        bottom: 'l',
                    }}>Start a chat by typing a question below.</Box>}
                </SpaceBetween>
            </Box>}
        </Container>

    )
}


