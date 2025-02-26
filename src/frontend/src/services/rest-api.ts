import { post } from "aws-amplify/api";

export const postMessage = async (message: string) => {
    const response = await post({
        apiName: "restApi",
        path: "/message",
        options: {
            body: message,
        },
    }).response;
    return await response.body.json();
};
