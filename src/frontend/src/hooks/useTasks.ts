import { useQuery } from "@tanstack/react-query";
import { fetchJsonFromPath } from "./useStorage";

export interface Task {
    id: string;
    name: string;
    description: string;
    status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";
    output?: Record<string, any>;
    workflow?: string;
}

export const useTasks = () => {
    return useQuery({
        queryKey: ['tasks'],
        queryFn: () => fetchJsonFromPath('workflows/tasks.json') as Promise<Task[]>,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
};

export const useTask = (taskId: string) => {
    const { data: tasks, ...rest } = useTasks();
    const task = tasks?.find(t => t.id === taskId);
    
    return {
        data: task,
        ...rest
    };
};