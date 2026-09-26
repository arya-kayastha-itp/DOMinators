import type { Metadata } from 'next'
import { Suspense } from 'react'
import { BlueprintView } from '@/components/views/blueprint'
import { PageSkeleton } from '@/components/views/page-skeleton'

export const metadata: Metadata = { title: 'Blueprint' }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BlueprintView />
    </Suspense>
  )
}
