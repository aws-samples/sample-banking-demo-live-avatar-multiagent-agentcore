// @export {"deleteFile": true}

import {
    AdminCreateUserCommand,
    AdminLinkProviderForUserCommand,
    AdminSetUserPasswordCommand,
    CognitoIdentityProviderClient,
    ListUsersCommand,
    MessageActionType,
} from "@aws-sdk/client-cognito-identity-provider";
import { GetRandomPasswordCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { PreSignUpTriggerEvent } from "aws-lambda";

const cognitoClient = new CognitoIdentityProviderClient();
const secretsClient = new SecretsManagerClient();

export const handler = async (event: PreSignUpTriggerEvent) => {
    const { request, userName, triggerSource, userPoolId } = event;
    let { email } = request.userAttributes;
    let username = userName;

    if (triggerSource === "PreSignUp_ExternalProvider") {
        if (!email) {
            const [, alias] = userName.split("_");
            if (alias) {
                email = `${alias}@amazon.com`;
            }
        }

        const listUsersResponse = await cognitoClient.send(
            new ListUsersCommand({
                UserPoolId: userPoolId,
                Filter: `email = "${email}"`,
                Limit: 1,
            })
        );
        const existingUser = listUsersResponse.Users?.[0];

        if (existingUser) {
            username = existingUser.Username!;
            console.log(`Found existing local user: ${username}.`);
        } else {
            const createUserResponse = await cognitoClient.send(
                new AdminCreateUserCommand({
                    UserPoolId: userPoolId,
                    Username: email,
                    MessageAction: MessageActionType.SUPPRESS,
                    UserAttributes: [{ Name: "email", Value: email }],
                })
            );
            username = createUserResponse.User!.Username!;
            await cognitoClient.send(
                new AdminSetUserPasswordCommand({
                    UserPoolId: userPoolId,
                    Username: username,
                    Password: (
                        await secretsClient.send(
                            new GetRandomPasswordCommand({
                                PasswordLength: 32,
                                RequireEachIncludedType: true,
                            })
                        )
                    ).RandomPassword,
                    Permanent: true,
                })
            );
            console.log(`Created new local user: ${username}.`);
        }

        const [providerName, providerUserId] = userName.split("_");
        await cognitoClient.send(
            new AdminLinkProviderForUserCommand({
                UserPoolId: userPoolId,
                DestinationUser: {
                    ProviderName: "Cognito",
                    ProviderAttributeValue: username,
                },
                SourceUser: {
                    ProviderName: providerName,
                    ProviderAttributeName: "Cognito_Subject",
                    ProviderAttributeValue: providerUserId,
                },
            })
        );
        console.log(`Successfully linked ${providerName} user to ${username}!`);
    }

    return event;
};
