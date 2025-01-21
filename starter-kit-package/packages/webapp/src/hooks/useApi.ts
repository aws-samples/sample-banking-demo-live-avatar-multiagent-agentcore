import { useQuery } from "@tanstack/react-query";
import { generateClient, post } from 'aws-amplify/api'
import { fetchAuthSession } from "aws-amplify/auth";
import { CreateToDoInput, ToDo, UpdateToDoInput } from "../API";
import { chatsByUserID, todoByOwnerID } from "../graphql/queries";
import { createChat, createToDo, deleteChat, resolverLambda, updateToDo } from "../graphql/mutations";
import { ChatInputType, QUERY_KEYS } from "../utils/types";

const client = generateClient();

export const postRest = async () => {
    console.log("Testing Rest POST API-->");
    try {
        const restOperation = post({
            apiName: 'rest-api',
            path: '/test',
            options: {
                headers: {
                    Authorization: (await fetchAuthSession()).tokens?.idToken?.toString() ?? ''
                },
                body: {
                    message: 'Mow the lawn'
                }
            }
        });

        const { body } = await restOperation.response;
        const response = await body.json();

        console.log('REST call succeeded');
        console.log(response);
        return response
    } catch (e) {
        console.log('REST call failed: ', e);
        return null
    }
}

export const postHTTP = async () => {
    console.log("Testing HTTP POST API-->");
    try {
        const restOperation = post({
            apiName: 'http-api',
            path: '/test',
            options: {
                headers: {
                    Authorization: (await fetchAuthSession()).tokens?.idToken?.toString() ?? ''
                },
                body: {
                    message: 'Mow the lawn'
                }
            }
        });

        const { body } = await restOperation.response;
        const response = await body.json();

        console.log('HTTP call succeeded');
        console.log(response);
        return response
    } catch (e) {
        console.log('HTTP call failed: ', e);
        return null
    }
}


const listToDoByUser = async (ownerID: string) => {
    let nextToken: string | null | undefined = "";
    let data: ToDo[] = []
    try {
        do {
            const variables: any = {
                ownerID,
                ...(nextToken && { nextToken })
            }
            const response = await client.graphql({
                query: todoByOwnerID,
                variables
            })
            console.log("🚀 ~ listToDoQuery ~ response:", response.data.todoByOwnerID.items)
            if (!response.data)
                return []
            nextToken = response.data.todoByOwnerID.nextToken
            // sort in descending order based on time
            const sorted = response.data.todoByOwnerID.items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            if (sorted)
                data = [...data, ...sorted]
        } while (nextToken != null)
        return data
    } catch (err) {
        console.log(err)
        return []
    }
}

export const useListToDo = (ownerID: string) =>
    useQuery({
        queryKey: [QUERY_KEYS.TODOS],
        queryFn: () => listToDoByUser(ownerID),
        enabled: ownerID.length > 0
    })


/**
* GraphQL Mutation
* @param campaign 
* @returns 
*/
export const addToDo = (input: CreateToDoInput) => client.graphql({
    query: createToDo,
    variables: {
        input
    }
})

export const markToDo = (input: UpdateToDoInput) => client.graphql({
    query: updateToDo,
    variables: {
        input
    }
})

export const addChat = (input: ChatInputType) => client.graphql({
    query: createChat,
    variables: {
        input: {
            userID: input.userID,
            human: input.message,
            bot: "..."
        }
    }
})

export const removeChat = (chatID: string) => client.graphql({
    query: deleteChat,
    variables: {
        input: {
            id: chatID
        }
    }
})

export const listChatsByUserID = async (userID: string) => {
    const response = await client.graphql({
        query: chatsByUserID,
        variables: {
            userID
        }
    });

    return response?.data?.chatsByUserID?.items.sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) ?? null
}


// to be used at page load
export const useListChatsByUser = (userID: string) => {
    return useQuery({
        queryKey: [QUERY_KEYS.CHATS, userID],
        queryFn: () => listChatsByUserID(userID),
        enabled: !!userID,
        refetchOnWindowFocus: true,
        refetchInterval: 10000,
        refetchIntervalInBackground: true,
        refetchOnMount: true,
        refetchOnReconnect: true,

    })
}


/**
 * Resolver Lambda
 * @param args 
 * @returns 
 */

export const appsyncResolver = (args: string) => client.graphql({
    query: resolverLambda,
    variables: {
        args,
    }
})