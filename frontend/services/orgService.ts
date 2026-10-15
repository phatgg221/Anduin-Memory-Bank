import { withApiErrors } from "@/lib/apiError";
import { axiosClient } from "@/lib/axiosClient";
import type { User } from "@/types/auth";
import type { Department } from "@/types/org";

export const orgService = {
  async listDepartments(): Promise<Department[]> {
    const { data } = await withApiErrors(axiosClient.get<Department[]>("/org/departments"));
    return data;
  },

  /** PUT with explicit state: safe to retry. null = All Departments. */
  async setActiveDepartment(departmentId: string | null): Promise<User> {
    const { data } = await withApiErrors(
      axiosClient.put<User>("/auth/me/active-department", { department_id: departmentId }),
    );
    return data;
  },
};
