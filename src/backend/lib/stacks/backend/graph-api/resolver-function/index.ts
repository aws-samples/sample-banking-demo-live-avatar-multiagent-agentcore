// import { AUTH_TYPE, AWSAppSyncClient } from "aws-appsync";
import { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";

interface Arguments {
    human: string;
}

export const handler = async (event: AppSyncResolverEvent<Arguments>) => {
    // const graphqlClient = new AWSAppSyncClient({
    //     url: process.env.GRAPH_API_URL!,
    //     region: process.env.AWS_REGION!,
    //     auth: {
    //         type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
    //         jwtToken: event.request.headers.authorization!,
    //     },
    //     disableOffline: true,
    // });
    const identity = event.identity as AppSyncIdentityCognito;

    return `${identity.claims.email} said "${event.arguments.human}."`;
};
