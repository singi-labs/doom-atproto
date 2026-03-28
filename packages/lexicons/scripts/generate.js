/**
 * Wrapper around lex-cli gen-server for Doom lexicons.
 *
 * Usage: node scripts/generate.js
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname
const LEXICONS_DIR = join(ROOT, 'lexicons')
const OUTPUT_DIR = join(ROOT, 'src', 'generated')

function findJsonFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(fullPath))
    } else if (entry.name.endsWith('.json')) {
      results.push(fullPath)
    }
  }
  return results
}

const files = findJsonFiles(LEXICONS_DIR)
if (files.length === 0) {
  console.error('No lexicon files found in', LEXICONS_DIR)
  process.exit(1)
}

console.log(`Found ${files.length} lexicon files`)

const cmd = `echo y | pnpm exec lex gen-server ${OUTPUT_DIR} ${files.join(' ')}`
execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
