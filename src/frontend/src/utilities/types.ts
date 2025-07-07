export enum QUERY_KEYS {
    VDA = "VDA",
    WORKFLOWS = "WORKFLOWS",
    TASKS = "TASKS",
}

// prefix in AWS S3
export const DatasetPrefix = {
    [QUERY_KEYS.VDA]: "vda/",
    [QUERY_KEYS.WORKFLOWS]: "workflows/",
    [QUERY_KEYS.TASKS]: "",
};

export type ItemType = { itemName: string; path: string; url: string };

export type AmazonData = {
    id: string;
    name: string;
    type: string;
    size: number;
    createdAt: string;
    updatedAt: string;
    path: string;
    organisation: string;
    addedBy: string;
    version: number;
};
