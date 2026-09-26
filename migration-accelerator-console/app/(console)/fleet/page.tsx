import type { Metadata } from 'next'
import { Suspense } from 'react'
import { FleetView } from '@/components/views/fleet'
import { PageSkeleton } from '@/components/views/page-skeleton'

export const metadata: Metadata = { title: 'Fleet' }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FleetView />
    </Suspense>
  )
}
