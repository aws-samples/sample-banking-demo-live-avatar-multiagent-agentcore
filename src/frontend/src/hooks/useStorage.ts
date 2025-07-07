import { useQuery } from "@tanstack/react-query";
import { downloadData, getUrl, list } from "aws-amplify/storage";
import { DatasetPrefix, ItemType, QUERY_KEYS } from "../utilities/types";
import { useCachedQuery } from "./useLocalCache";

export const fetchJsonFromPath = async (path: string) => {
    try {
        const downloadResult = await downloadData({ 
            path,
            options: {
                bucket: 'storageBucket'
            }
        }).result;
        console.log('downloadResult', downloadResult, 'path', path, 'storageBucket')
        const text = await downloadResult.body.text();
        return JSON.parse(text);
    } catch (e) {
        console.warn(`File not found: ${path}`, e);
        return null;
    }
};

export const getItemUrl = async (path: string, itemName: string) => {
    const results = await getUrl({
        path: `${path}${itemName}`,
        options: {
            bucket: 'storageBucket',
            validateObjectExistence: true, // Check if object exists before creating a URL
            expiresIn: 3600, // validity of the URL, in seconds. defaults to 900 (15 minutes) and maxes at 3600 (1 hour)
        },
    });
    return {
        itemName: itemName,
        path,
        url: results.url.href.toString(),
    };
};

export const listItems = async (path: string) => {
    try {
        const result = await list({
            path,
            options: {
                bucket: 'storageBucket'
            }
        });

        // this will list all files in path remove the root directory itself and list only the files within it
        // length 2 to avoid "/" for root folders
        const items = result.items
            .map((item) => item.path.split(path)[1])
            .filter((i) => i.length > 2);
        console.log("🚀 ~ listItems ~ items:", items);

        // iterates over all item keys and awaits until all URLs for each individual item has been received
        const urlList = (await Promise.all(items.map(async (i) => await getItemUrl(path, i))).then(
            (values) => values
        )) as ItemType[];

        console.log("🚀 ~ listItems ~ urlList:", urlList);

        return urlList;
    } catch (error) {
        console.log(error);
        return [];
    }
};

export const useS3ListItems = (type: QUERY_KEYS) => {
    return useQuery({
        queryKey: [type],
        queryFn: () => listItems(DatasetPrefix[type]),
        enabled: DatasetPrefix[type].length > 0,
    });
};

export const getWorkflowAssetUrl = async (workflow: string, assetType: 'screenshot' | 'video', fileName: string) => {
    const path = `workflows/${workflow}/${assetType}/${fileName}`;
    try {
        const results = await getUrl({
            path,
            options: {
                bucket: 'storageBucket',
                validateObjectExistence: true,
                expiresIn: 3600,
            },
        });
        return results.url.href.toString();
    } catch (e) {
        console.log(`Failed to get URL for ${path}:`, e);
        return null;
    }
};

export const fetchWorkflowJson = async (workflow: string) => {
    const path = `workflows/${workflow}/flow.json`;
    return fetchJsonFromPath(path);
};

export const useCachedWorkflowJson = (workflow: string, useCache: boolean = true) => {
    const path = `workflows/${workflow}/flow.json`;
    return useCachedQuery(
        ['workflow-json', workflow],
        () => fetchJsonFromPath(path),
        { enabled: !!workflow, staleTime: useCache ? 30 * 60 * 1000 : 0 }
    );
};

export const useCachedWorkflowAssetUrl = (workflow: string, assetType: 'screenshot' | 'video', fileName: string, useCache: boolean = true) => {
    return useCachedQuery(
        ['asset-url', workflow, assetType, fileName],
        () => getWorkflowAssetUrl(workflow, assetType, fileName),
        { enabled: !!(workflow && assetType && fileName), staleTime: useCache ? 50 * 60 * 1000 : 0 }
    );
};

export const fetchTaskOutput = async (workflow: string) => {
    const path = `workflows/${workflow}/task-output.json`;
    return fetchJsonFromPath(path);
};

export const useTaskOutput = (workflow: string) => {
    return useQuery({
        queryKey: ['task-output', workflow],
        queryFn: () => fetchTaskOutput(workflow),
        enabled: !!workflow,
        staleTime: 5 * 60 * 1000,
    });
};
