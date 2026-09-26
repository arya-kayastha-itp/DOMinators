import { ConsoleProvider } from '@/components/console/console-provider'
import { AppShell } from '@/components/shell/app-shell'

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleProvider>
      <AppShell>{children}</AppShell>
    </ConsoleProvider>
  )
}
