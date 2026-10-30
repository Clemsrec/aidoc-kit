/**
 * 'use client' / 'use server' directive of a module, if any. Leading line and
 * block comments are skipped: aidoc-kit writes its own @ai-* block above the
 * directive, which must not hide it.
 */
export function detectDirective(source: string): 'client' | 'server' | null {
  const body = source.replace(/^(?:#![^\n]*\n)?(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '')
  const match = body.match(/^['"]use (client|server)['"]/)
  return match ? (match[1] as 'client' | 'server') : null
}
