import type { Metadata } from 'next'
import { DependenciesView } from '@/components/views/dependencies'

export const metadata: Metadata = { title: 'Dependencies' }

export default function Page() {
  return <DependenciesView />
}
