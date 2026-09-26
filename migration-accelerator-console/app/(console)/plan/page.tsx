import type { Metadata } from 'next'
import { PlanView } from '@/components/views/plan'

export const metadata: Metadata = { title: 'Wave plan' }

export default function Page() {
  return <PlanView />
}
