import { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";

interface Arguments {
    message: string;
}

export const handler = async (event: AppSyncResolverEvent<Arguments>) => {
    const identity = event.identity as AppSyncIdentityCognito;

    return {
        content: `${identity.claims.email} said "${event.arguments.message}."`,
        type: "success",
    };
};
