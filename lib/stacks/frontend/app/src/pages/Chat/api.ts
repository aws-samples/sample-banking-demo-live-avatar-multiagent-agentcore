import { generateClient, post } from "aws-amplify/api";
import { testMessage } from "../../common/graphql/mutations";
import { TestMessageMutationVariables } from "../../common/graphql/types";

export const postRestTestMessage = async (message: string) => {
    const response = await post({
        apiName: "restApi",
        path: "/message",
        options: {
            body: message,
        },
    }).response;
    return await response.body.json();
};

const client = generateClient();

export const postGraphTestMessage = async (message: string) => {
    const { data } = await client.graphql({
        query: testMessage,
        variables: {
            message
        } as TestMessageMutationVariables,
    });
    return JSON.parse(data.testMessage);
};
