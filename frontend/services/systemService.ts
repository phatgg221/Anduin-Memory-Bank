import { axiosClient } from "@/lib/axiosClient";
import type { Health } from "@/types/system";

export const systemService = {
  async getHealth(): Promise<Health> {
    // A 503 still carries a body saying which dependency is down.
    const { data } = await axiosClient.get<Health>("/health", {
      validateStatus: (status) => status === 200 || status === 503,
    });
    return data;
  },
};
