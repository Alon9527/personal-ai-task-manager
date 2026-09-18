// Explicit allowlist publication without changing the local .git directory.
// Default is a read-only audit. --publish atomically commits to the expected remote HEAD.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, sep } from 'node:path'

const root = process.cwd()
const repo = 'Alon9527/personal-ai-task-manager'
function command(file, args, input) {
  return execFileSync(file, args, { cwd: root, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, windowsHide: true })
}
function api(endpoint, payload) {
  return JSON.parse(command('gh', ['api', endpoint, ...(payload ? ['--input', '-'] : [])], payload ? JSON.stringify(payload) : undefined))
}
const changed = command('git', ['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean)
const untracked = command('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
const candidates = [...new Set([...changed, ...untracked])].sort()
const allowed = /^(?:app\/|shared\/|server\/|tests\/|scripts\/|supabase\/migrations\/|src-tauri\/src\/|src-tauri\/capabilities\/|src-tauri\/icons\/focus\/(?:32x32\.png|128x128\.png|128x128@2x\.png|icon\.ico)$|src-tauri\/icons\/focus-source\.svg$|src-tauri\/(?:Cargo\.toml|Cargo\.lock|tauri\.conf\.json)$|\.github\/workflows\/release-windows\.yml$|(?:nuxt|playwright)\.config\.ts$|docs\/github-updates\.md$)/
const blocked = /(?:^|\/)(?:\.env[^/]*|\.git|\.aws|\.ssh|credentials)(?:\/|$)|\.(?:key|pem|pfx|p12|sqlite3?|db|log|bak)$|(?:^|\/)(?:node_modules|target|artifacts|test-results)(?:\/|$)/i
const paths = candidates.filter(path => allowed.test(path) && !blocked.test(path))
let additions = []
const findings = []
for (const path of paths) {
  const absolute = resolve(root, path)
  if (relative(root, absolute).startsWith(`..${sep}`)) throw new Error('Path escaped project')
  const content = readFileSync(absolute)
  if (!/\.(?:png|ico)$/.test(path)) {
    const text = content.toString('utf8')
    const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{35,}\b/, /\bsk-[A-Za-z0-9_-]{30,}\b/, /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/]
    if (patterns.some(pattern => pattern.test(text))) findings.push(path)
  }
  additions.push({ path, contents: content.toString('base64') })
}
if (findings.length) throw new Error(`Possible secret material; publication stopped. Files only: ${findings.join(', ')}`)
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const localHead = command('git', ['rev-parse', 'HEAD']).trim()
const remoteHead = api(`repos/${repo}/git/ref/heads/main`).object.sha
// Local .git remains untouched after API publication. An explicit previous release
// can be used as baseline only if it is still the current main HEAD (no remote edits).
const baseIndex = process.argv.indexOf('--base-ref')
const baseRef = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined
if (baseIndex >= 0 && !/^v\d+\.\d+\.\d+$/.test(baseRef || '')) throw new Error('Expected a reviewed release tag after --base-ref')
const expectedHead = baseRef ? api(`repos/${repo}/commits/${baseRef}`).sha : localHead
if (expectedHead !== remoteHead) throw new Error('Remote HEAD changed since baseline; review before publishing')
const remoteTree = api(`repos/${repo}/git/trees/${remoteHead}?recursive=1`)
if (remoteTree.truncated) throw new Error('Remote tree is truncated; cannot audit additions safely')
const remoteBlobs = new Map(remoteTree.tree.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.sha]))
additions = additions.filter(file => {
  const bytes = Buffer.from(file.contents, 'base64')
  const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  return remoteBlobs.get(file.path) !== oid
})
const oldFile = api(`repos/${repo}/contents/src-tauri/tauri.conf.json?ref=v0.3.3`)
const oldConfig = JSON.parse(Buffer.from(oldFile.content, 'base64').toString('utf8'))
if (config.identifier !== oldConfig.identifier || config.plugins.updater.pubkey !== oldConfig.plugins.updater.pubkey) throw new Error('Old clients would lose identifier/key compatibility')
console.log(JSON.stringify({ version: config.version, localHead, remoteHead, baseRef, files: additions.map(file => file.path), excluded: candidates.filter(path => !paths.includes(path)), updaterKeyCompatible: true, secretPatternFindings: findings.length }, null, 2))
if (!process.argv.includes('--publish')) process.exit(0)
if (!additions.length) throw new Error('No source changes to publish')
const mutation = 'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid url}}}'
const response = api('graphql', { query: mutation, variables: { input: {
  branch: { repositoryNameWithOwner: repo, branchName: 'main' }, expectedHeadOid: remoteHead,
  message: { headline: `release: Focus ${config.version} signed GitHub updates and task improvements` }, fileChanges: { additions },
} } })
if (response.errors?.length) throw new Error('GitHub rejected the atomic commit')
console.log(JSON.stringify({ publishedCommit: response.data.createCommitOnBranch.commit }))
