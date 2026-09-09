export default function MarketingLoading() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero skeleton */}
      <div className="pt-20 pb-8 lg:pt-24 lg:pb-12">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="text-center max-w-4xl mx-auto animate-pulse">
            <div className="h-8 w-48 bg-[#001E3C]/10 rounded-full mx-auto" />
            <div className="mt-8 space-y-4">
              <div className="h-12 w-3/4 bg-[#001E3C]/10 rounded-lg mx-auto" />
              <div className="h-12 w-2/3 bg-[#001E3C]/10 rounded-lg mx-auto" />
            </div>
            <div className="mt-6 h-6 w-2/3 bg-[#001E3C]/5 rounded mx-auto" />
            <div className="mt-10 h-12 w-48 bg-[#001E3C]/10 rounded-full mx-auto" />
          </div>
        </div>
      </div>

      {/* Content skeleton */}
      <div className="mx-auto max-w-7xl px-4 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-[#001E3C]/5 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
