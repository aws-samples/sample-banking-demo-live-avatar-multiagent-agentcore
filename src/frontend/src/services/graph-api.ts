import { generateClient } from "aws-amplify/api";
import { SendChatMutationVariables } from "../API";
import { sendChat } from "../graphql/mutations";

const client = generateClient();

export const sendMessage = async (message: string) => {
    const { data } = await client.graphql({
        query: sendChat,
        variables: {
            human: message,
        } as SendChatMutationVariables,
    });
    return data.sendChat;
};
