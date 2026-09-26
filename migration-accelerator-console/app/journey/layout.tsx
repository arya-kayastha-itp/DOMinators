import type { Metadata } from 'next'
import { Instrument_Serif } from 'next/font/google'
import './journey.css'

// Editorial italic for accent words; the sans and mono come from the root layout (Geist).
const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--font-serif' })

export const metadata: Metadata = {
  title: 'The Pipeline Journey',
  description: 'Four agents move a legacy AWS estate onto a hardened landing zone — discover, plan, blueprint, cut over — with gates that roll back on their own.',
}

export default function JourneyLayout({ children }: { children: React.ReactNode }) {
  return <div className={serif.variable}>{children}</div>
}
