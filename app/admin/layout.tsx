import { requireRole } from "@/lib/auth/roles";
import { Sidebar } from "@/components/Sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["admin"]);

  return (
    <div className="flex min-h-screen">
      <Sidebar role={profile.role_code} fullName={profile.full_name} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
