import { useQuery } from "@tanstack/react-query";
import { systemService } from "@/services/systemService";
import { queryKeys } from "./queryKeys";

export function useSystemHealth() {
  return useQuery({
    queryKey: queryKeys.system.health,
    queryFn: systemService.getHealth,
    refetchInterval: 10_000,
    retry: false,
  });
}
