import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/scripts/[name]
 * Publicly serves static scripts from public/scripts/ directory.
 * This route is under /api/ so it bypasses the auth middleware.
 * Allowed extensions: .sh, .js, .py
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  const name = params.name

  // Security: only allow alphanumeric, dash, underscore, dot — no path traversal
  if (!name || !/^[\w\-\.]+$/.test(name) || name.includes('..')) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Only serve allowed script extensions
  const ext = path.extname(name).toLowerCase()
  if (!['.sh', '.js', '.py'].includes(ext)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const scriptPath = path.join(process.cwd(), 'public', 'scripts', name)

  if (!fs.existsSync(scriptPath)) {
    return new NextResponse(`Script "${name}" not found`, { status: 404 })
  }

  const content = fs.readFileSync(scriptPath, 'utf-8')

  const contentTypeMap: Record<string, string> = {
    '.sh': 'text/x-shellscript; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.py': 'text/x-python; charset=utf-8',
  }

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': contentTypeMap[ext] || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}
