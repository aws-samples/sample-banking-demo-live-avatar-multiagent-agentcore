import { useQuery } from "@tanstack/react-query";
import { fetchWorkflowJson, useCachedWorkflowJson } from "./useStorage";

export const useWorkflowData = (workflow: string, useCache: boolean = true) => {
    if (useCache) {
        return useCachedWorkflowJson(workflow, true);
    }
    
    return useQuery({
        queryKey: ['workflow', workflow],
        queryFn: () => fetchWorkflowJson(workflow),
        enabled: !!workflow,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
};