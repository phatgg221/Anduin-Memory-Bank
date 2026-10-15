import { withApiErrors } from "@/lib/apiError";
import { axiosClient } from "@/lib/axiosClient";
import type { ArtifactLink, VaultView } from "@/types/vault";

export const vaultService = {
  async getCases(departmentId: string | null): Promise<VaultView> {
    const params = departmentId ? { department_id: departmentId } : undefined;
    const { data } = await withApiErrors(axiosClient.get<VaultView>("/vault/cases", { params }));
    return data;
  },

  /** A fresh presigned link per click; links expire, so they're never cached. */
  async getArtifactLink(artifactId: string): Promise<ArtifactLink> {
    const { data } = await withApiErrors(axiosClient.post<ArtifactLink>(`/vault/artifacts/${artifactId}/link`));
    return data;
  },
};
