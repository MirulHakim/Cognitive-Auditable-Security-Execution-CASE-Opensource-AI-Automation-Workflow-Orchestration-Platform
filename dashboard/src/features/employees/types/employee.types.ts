export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: "active" | "inactive" | "on_leave";
  avatarUrl?: string;
  joinedAt: string;
}
