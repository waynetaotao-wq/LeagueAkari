import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

// Keep this list aligned with electron-builder.yml and the workflow's normalized names.
const REQUIRED_ASSETS = [
  'league-akari-win-x64.7z',
  'league-akari-mac-arm64.dmg',
  'league-akari-mac-arm64.zip'
]
const ALLOWED_ASSETS = new Set([...REQUIRED_ASSETS, 'league-akari-win-x64.exe'])

export async function collectArtifacts(directory) {
  const artifacts = new Map()
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(file)
        continue
      }
      if (!entry.isFile() || !ALLOWED_ASSETS.has(entry.name) || artifacts.has(entry.name)) {
        throw new Error(`Unexpected or duplicate release artifact: ${file}`)
      }
      const { size } = await stat(file)
      if (!size) throw new Error(`Empty release artifact: ${file}`)
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(file)) hash.update(chunk)
      artifacts.set(entry.name, {
        file,
        name: entry.name,
        size,
        digest: `sha256:${hash.digest('hex')}`
      })
    }
  }
  await visit(directory)
  for (const name of REQUIRED_ASSETS) {
    if (!artifacts.has(name)) throw new Error(`Missing release artifact: ${name}`)
  }
  return [...artifacts.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function matchesAsset(actual, expected) {
  return (
    actual?.state === 'uploaded' &&
    actual.size === expected.size &&
    actual.digest === expected.digest
  )
}

function verifyRelease(release, metadata) {
  if (release.tag_name !== metadata.tag || release.target_commitish !== metadata.sha) {
    throw new Error(`Release does not belong to the requested commit ${metadata.sha}`)
  }
}

export async function publishRelease(
  metadata,
  artifacts,
  client,
  { wait = setTimeout, log = console.log } = {}
) {
  async function retry(label, operation) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await operation()
      } catch (error) {
        log(`${label} (${attempt}/4): ${error.message}`)
        if (attempt === 4) throw error
        await wait(5000 * 2 ** (attempt - 1))
      }
    }
  }

  // Re-read after an uncertain create response; never delete a release on retry.
  const release = await retry('Prepare release', async () => {
    const existing = await client.getRelease()
    if (existing) return existing
    await client.createDraft()
    const created = await client.getRelease()
    if (!created) throw new Error('Created release is not visible yet')
    return created
  })
  verifyRelease(release, metadata)

  for (const artifact of artifacts) {
    await retry(`Upload ${artifact.name}`, async () => {
      const assets = await client.listAssets(release.id)
      const existing = assets.find((asset) => asset.name === artifact.name)
      if (matchesAsset(existing, artifact)) {
        log(`Verified existing ${artifact.name} (${artifact.size} bytes, ${artifact.digest})`)
        return
      }
      if (existing) {
        // A draft may contain a failed upload (including GitHub's zero-byte "starter" asset).
        // Published files must not disappear just because a rerun produced different bytes.
        const current = await client.getRelease()
        if (!current?.draft) throw new Error(`Refusing to replace published asset ${artifact.name}`)
        verifyRelease(current, metadata)
        await client.deleteAsset(existing.id)
      }
      log(`Uploading ${artifact.name} (${artifact.size} bytes)`)
      await client.upload(artifact.file)
      const uploaded = (await client.listAssets(release.id)).find(
        (asset) => asset.name === artifact.name
      )
      if (!matchesAsset(uploaded, artifact)) {
        throw new Error(`Upload verification failed for ${artifact.name} (state, size or SHA-256)`)
      }
      log(`Verified ${artifact.name}: ${artifact.digest}`)
    })
  }

  async function verifyAll() {
    const current = await client.getRelease()
    if (!current) throw new Error('Release is missing')
    verifyRelease(current, metadata)
    const assets = await client.listAssets(current.id)
    for (const artifact of artifacts) {
      if (
        !matchesAsset(
          assets.find((asset) => asset.name === artifact.name),
          artifact
        )
      ) {
        throw new Error(`Final verification failed for ${artifact.name}`)
      }
    }
    return current
  }

  await retry('Publish verified release', async () => {
    const current = await verifyAll()
    if (current.draft) await client.publish()
    const published = await verifyAll()
    if (published.draft || published.prerelease !== metadata.prerelease) {
      throw new Error('Release publication state does not match the requested metadata')
    }
  })
  log(`Published ${metadata.tag}: all ${artifacts.length} assets verified`)
}

function githubClient(metadata) {
  function gh(args) {
    try {
      return execFileSync('gh', args, {
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      // Do not log environment variables, credentials or complete process objects.
      throw new Error(error.stderr?.trim() || error.code || 'GitHub CLI request failed')
    }
  }
  const repoPath = `repos/${metadata.repository}`
  function api(endpoint, extra = []) {
    const output = gh(['api', `${repoPath}/${endpoint}`, ...extra])
    return output.trim() ? JSON.parse(output) : undefined
  }
  const releaseArgs = [metadata.tag, '--repo', metadata.repository]
  return {
    getRelease() {
      // The tag endpoint only guarantees published releases. The authenticated list includes drafts.
      return (
        api('releases?per_page=100', ['--paginate', '--slurp'])
          .flat()
          .find((release) => release.tag_name === metadata.tag) ?? null
      )
    },
    createDraft() {
      gh([
        'release',
        'create',
        ...releaseArgs,
        '--target',
        metadata.sha,
        '--title',
        metadata.name,
        '--draft',
        `--prerelease=${metadata.prerelease}`,
        '--latest=false',
        ...(metadata.generateNotes ? ['--generate-notes'] : ['--notes', ''])
      ])
    },
    listAssets: (id) => api(`releases/${id}/assets?per_page=100`),
    deleteAsset: (id) => api(`releases/assets/${id}`, ['--method', 'DELETE']),
    upload: (file) => gh(['release', 'upload', ...releaseArgs, file]),
    publish: () =>
      gh([
        'release',
        'edit',
        ...releaseArgs,
        '--draft=false',
        `--latest=${metadata.makeLatest}`,
        `--prerelease=${metadata.prerelease}`
      ])
  }
}

async function main() {
  for (const key of [
    'GITHUB_REPOSITORY',
    'GITHUB_SHA',
    'GH_TOKEN',
    'RELEASE_TAG',
    'RELEASE_NAME'
  ]) {
    if (!process.env[key]) throw new Error(`Missing ${key}`)
  }
  const metadata = {
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    tag: process.env.RELEASE_TAG,
    name: process.env.RELEASE_NAME,
    prerelease: process.env.RELEASE_PRERELEASE === 'true',
    makeLatest: process.env.RELEASE_MAKE_LATEST === 'true',
    generateNotes: process.env.RELEASE_GENERATE_NOTES === 'true'
  }
  const artifacts = await collectArtifacts('release-artifacts')
  await publishRelease(metadata, artifacts, githubClient(metadata))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
