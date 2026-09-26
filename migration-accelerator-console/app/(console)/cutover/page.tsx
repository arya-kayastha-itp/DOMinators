import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CutoverView } from '@/components/views/cutover'
import { PageSkeleton } from '@/components/views/page-skeleton'

export const metadata: Metadata = { title: 'Cutover' }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CutoverView />
    </Suspense>
  )
}
