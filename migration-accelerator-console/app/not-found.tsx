import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="font-mono text-sm text-subtle">404</div>
      <h1 className="text-2xl font-semibold tracking-tight">This route didn&apos;t migrate</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The page you asked for isn&apos;t part of the console.</p>
      <Link href="/" className="mt-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground">Back to Overview</Link>
    </main>
  )
}
