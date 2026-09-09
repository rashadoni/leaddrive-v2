import { redirect } from "next/navigation"
import { isSuperAdminSession } from "@/lib/superadmin-guard"
import Link from "next/link"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const isSuperAdmin = await isSuperAdminSession()
  if (!isSuperAdmin) {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Top nav */}
      <header className="border-b bg-white dark:bg-zinc-900 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="text-lg font-bold text-primary">
            LeadDrive Admin
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin" className="text-muted-foreground hover:text-foreground transition-colors">
              Dashboard
            </Link>
            <Link href="/admin/tenants" className="text-muted-foreground hover:text-foreground transition-colors">
              Tenants
            </Link>
            <Link href="/admin/plans" className="text-muted-foreground hover:text-foreground transition-colors">
              Plans
            </Link>
          </nav>
        </div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Back to CRM
        </Link>
      </header>
      {/* Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {children}
      </main>
    </div>
  )
}
