import type { Metadata } from 'next'
import { ImpactView } from '@/components/views/impact'

export const metadata: Metadata = { title: 'Impact' }

export default function Page() {
  return <ImpactView />
}
