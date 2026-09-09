import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center px-4">
        <h1 className="text-8xl font-bold text-orange-500">404</h1>
        <h2 className="mt-4 text-2xl font-semibold text-foreground">Səhifə tapılmadı</h2>
        <p className="mt-2 text-muted-foreground">Axtardığınız səhifə mövcud deyil və ya köçürülüb.</p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/home"
            className="rounded-full bg-orange-500 hover:bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            Ana səhifəyə qayıt
          </Link>
          <Link
            href="/contact"
            className="rounded-full border border-border hover:border-foreground/50 px-6 py-2.5 text-sm font-semibold text-foreground transition-colors"
          >
            Əlaqə
          </Link>
        </div>
      </div>
    </div>
  )
}
