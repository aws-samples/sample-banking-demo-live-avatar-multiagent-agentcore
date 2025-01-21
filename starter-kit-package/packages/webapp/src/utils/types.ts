// query keys
export enum QUERY_KEYS {
    CAROUSAL = "CAROUSAL",
    TODOS = "TODOS",
    CHATS = "CHATS",

}

// AWS S3 folder prefixes mapped to React Query keys
// trailing / is required for folder prefixes
// export const DatasetPrefix = {
//     [QUERY_KEYS.CAROUSAL]: "carousal/",
// }



export type ItemType = { itemName: string, path: string; url: string }

export type S3ItemsType = {
    eTag: string | undefined,
    lastModified: Date | undefined,
    size: number | undefined,
    path: string,

}

export type ChatInputType = {
    userID: string;
    message: string;

}

export type AuthedUserType = {
    userID: string;
    userName: string;

}