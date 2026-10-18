import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import type { Agent, AIModel, Chat, KnowledgeBase, Project, Service, User } from "@/lib/types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await get<User>("/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

/** Optimistically update the balance shown in the shell after spending or topping up. */
export function useSetBalance() {
  const qc = useQueryClient();
  return (balance: number) => qc.setQueryData<User | null>(["me"], (u) => (u ? { ...u, balance } : u));
}

export const useModels = () => useQuery({ queryKey: ["models"], queryFn: () => get<AIModel[]>("/models"), staleTime: 300_000 });
export const useAgents = () => useQuery({ queryKey: ["agents"], queryFn: () => get<Agent[]>("/agents") });
export const useChats = () => useQuery({ queryKey: ["chats"], queryFn: () => get<Chat[]>("/chats") });
export const useKnowledge = () => useQuery({ queryKey: ["knowledge"], queryFn: () => get<KnowledgeBase[]>("/knowledge") });
export const useServices = () => useQuery({ queryKey: ["services"], queryFn: () => get<Service[]>("/services"), staleTime: 600_000 });
export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => get<Project[]>("/projects") });
