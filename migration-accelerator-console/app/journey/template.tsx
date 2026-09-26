'use client'

import { motion } from 'framer-motion'

// Route entrance for /journey (Framer Motion). Opacity only: a transform here
// would become the containing block for every fixed and pinned element inside.
export default function JourneyTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  )
}
