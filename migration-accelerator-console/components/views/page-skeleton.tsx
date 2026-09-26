import { Skeleton } from '@/components/ui/primitives'

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface flex flex-col gap-3 p-5"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-20" /><Skeleton className="h-8 w-full" /></div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="surface p-5 xl:col-span-2"><Skeleton className="h-64 w-full" /></div>
        <div className="surface p-5"><Skeleton className="h-64 w-full" /></div>
      </div>
    </div>
  )
}
