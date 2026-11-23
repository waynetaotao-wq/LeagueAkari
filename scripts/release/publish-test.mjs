import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { buildMatrix, releaseAssets, selectBuildTargets } from './build-targets.mjs'
import { collectArtifacts, publishRelease } from './publish.mjs'

const names = [
  'league-akari-win-x64.7z',
  'league-akari-mac-arm64.dmg',
  'league-akari-mac-arm64.zip'
]
const tagRef = 'refs/tags/v1.2.3'
const devRef = 'refs/heads/dev'
const metadata = { sha: 'a'.repeat(40), tag: `ci-${'a'.repeat(40)}`, prerelease: true }
const artifacts = names.map((name) => ({
  name,
  file: name,
  size: 4,
  digest: `sha256:${createHash('sha256').update('test').digest('hex')}`
}))
const noDelay = { wait: async () => {}, log: () => {} }

function fixture({ draft = true, assets = [], exists = true, overrides = {} } = {}) {
  const state = {
    exists,
    release: {
      id: 1,
      tag_name: metadata.tag,
      target_commitish: metadata.sha,
      prerelease: true,
      draft
    },
    assets: structuredClone(assets),
    uploaded: [],
    deleted: [],
    published: 0,
    created: 0
  }
  const client = {
    getRelease: async () => (state.exists ? { ...state.release } : null),
    createDraft: async () => {
      state.exists = true
      state.created++
    },
    listAssets: async () => structuredClone(state.assets),
    deleteAsset: async (id) => {
      state.deleted.push(id)
      state.assets = state.assets.filter((asset) => asset.id !== id)
    },
    upload: async (file) => {
      state.uploaded.push(file)
      const artifact = artifacts.find((item) => item.file === file)
      state.assets.push({ ...artifact, id: 100 + state.uploaded.length, state: 'uploaded' })
    },
    publish: async () => {
      state.release.draft = false
      state.published++
    }
  }
  Object.assign(client, overrides)
  return { state, client }
}

async function artifactDirectory(t, entries = names) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'akari-release-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const entry of entries) {
    const file = path.join(directory, entry)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, 'test')
  }
  return directory
}

test('a version tag builds every platform and a dev push builds Windows only', () => {
  assert.deepEqual(
    selectBuildTargets(tagRef).map((target) => target.name),
    ['macOS', 'Windows']
  )
  assert.deepEqual(
    selectBuildTargets(devRef).map((target) => target.name),
    ['Windows']
  )
  assert.throws(() => selectBuildTargets(undefined), /git ref is required/)
})

test('the build matrix carries what the workflow reads and nothing else', () => {
  const keys = [
    'artifact_name',
    'artifact_paths',
    'build_command',
    'cache_path',
    'name',
    'os',
    'release_asset_prefix'
  ]
  for (const ref of [tagRef, devRef]) {
    const { include } = buildMatrix(ref)
    assert.equal(include.length, selectBuildTargets(ref).length)
    for (const job of include) {
      assert.deepEqual(Object.keys(job).sort(), keys)
      for (const key of keys) assert.equal(typeof job[key], 'string')
    }
    // The workflow passes this through a single-line job output.
    assert.doesNotMatch(JSON.stringify(buildMatrix(ref)), /[\r\n]/)
  }
})

test('the expected release files follow the platforms that were built', () => {
  assert.deepEqual(releaseAssets(tagRef).required.sort(), [...names].sort())
  assert.deepEqual(releaseAssets(devRef).required, ['league-akari-win-x64.7z'])
  for (const ref of [tagRef, devRef]) {
    const { required, allowed } = releaseAssets(ref)
    for (const name of required) assert.ok(allowed.includes(name))
    // Every expected file is one the matching build job uploads under its normalized name.
    for (const name of allowed) {
      assert.ok(
        buildMatrix(ref).include.some(
          (job) =>
            name.startsWith(`${job.release_asset_prefix}.`) &&
            job.artifact_paths.split('\n').includes(`dist/*${path.extname(name)}`)
        ),
        name
      )
    }
  }
})

test('collects all platform packages and hashes the actual bytes', async (t) => {
  const directory = await artifactDirectory(
    t,
    names.map((name) => `platform/${name}`)
  )
  const collected = await collectArtifacts(directory, releaseAssets(tagRef))
  assert.equal(collected.length, 3)
  for (const artifact of collected) {
    assert.equal(artifact.size, 4)
    assert.equal(artifact.digest, artifacts[0].digest)
  }
})

test('rejects a missing platform package, empty package and duplicate name', async (t) => {
  const assets = releaseAssets(tagRef)
  const missing = await artifactDirectory(t, names.slice(0, 2))
  await assert.rejects(collectArtifacts(missing, assets), /Missing release artifact/)
  const empty = await artifactDirectory(t)
  await writeFile(path.join(empty, names[0]), '')
  await assert.rejects(collectArtifacts(empty, assets), /Empty release artifact/)
  const duplicate = await artifactDirectory(t, [...names, `other/${names[0]}`])
  await assert.rejects(collectArtifacts(duplicate, assets), /duplicate release artifact/)
})

test('a dev prerelease needs the Windows package and accepts nothing it did not build', async (t) => {
  const assets = releaseAssets(devRef)
  const windowsOnly = await artifactDirectory(t, ['windows/league-akari-win-x64.7z'])
  assert.deepEqual(
    (await collectArtifacts(windowsOnly, assets)).map((artifact) => artifact.name),
    ['league-akari-win-x64.7z']
  )
  const withInstaller = await artifactDirectory(t, [
    'windows/league-akari-win-x64.7z',
    'windows/league-akari-win-x64.exe'
  ])
  assert.equal((await collectArtifacts(withInstaller, assets)).length, 2)
  const noPackage = await artifactDirectory(t, ['windows/league-akari-win-x64.exe'])
  await assert.rejects(collectArtifacts(noPackage, assets), /Missing release artifact/)
  const stray = await artifactDirectory(t, names)
  await assert.rejects(collectArtifacts(stray, assets), /Unexpected or duplicate release artifact/)
})

test('creates a draft, uploads sequentially, verifies and then publishes', async () => {
  const { state, client } = fixture({ exists: false })
  const upload = client.upload
  let uploading = false
  client.upload = async (file) => {
    assert.equal(uploading, false)
    assert.equal(state.release.draft, true)
    uploading = true
    await new Promise((resolve) => setImmediate(resolve))
    await upload(file)
    uploading = false
  }
  await publishRelease(metadata, artifacts, client, noDelay)
  assert.equal(state.created, 1)
  assert.deepEqual(state.uploaded, names)
  assert.equal(state.published, 1)
  assert.equal(state.release.draft, false)
})

test('recovers when create or upload succeeded but the response was lost', async () => {
  const { state, client } = fixture({ exists: false })
  const create = client.createDraft
  const upload = client.upload
  client.createDraft = async () => {
    await create()
    throw new Error('response lost')
  }
  client.upload = async (file) => {
    await upload(file)
    throw new Error('response lost')
  }
  await publishRelease(metadata, artifacts, client, noDelay)
  assert.equal(state.created, 1)
  assert.deepEqual(state.uploaded, names)
  assert.deepEqual(state.deleted, [])
  assert.equal(state.published, 1)
})

test('reruns keep verified files and replace only an incomplete draft asset', async () => {
  const good = { ...artifacts[0], id: 11, state: 'uploaded' }
  const broken = { ...artifacts[1], id: 12, size: 0, digest: null, state: 'starter' }
  const { state, client } = fixture({ assets: [good, broken] })
  await publishRelease(metadata, artifacts, client, noDelay)
  assert.deepEqual(state.deleted, [12])
  assert.deepEqual(state.uploaded, names.slice(1))
  assert.deepEqual(
    state.assets.find((asset) => asset.id === 11),
    good
  )
})

test('stops after bounded retries and leaves partial results unpublished', async () => {
  const { state, client } = fixture()
  const upload = client.upload
  let attempts = 0
  client.upload = async (file) => {
    if (file === names[1]) {
      attempts++
      throw new Error('HTTP 502')
    }
    await upload(file)
  }
  const waits = []
  await assert.rejects(
    publishRelease(metadata, artifacts, client, { ...noDelay, wait: async (ms) => waits.push(ms) }),
    /HTTP 502/
  )
  assert.equal(attempts, 4)
  assert.deepEqual(waits, [5000, 10000, 20000])
  assert.equal(state.published, 0)
  assert.equal(state.release.draft, true)
  assert.deepEqual(state.uploaded, [names[0]])
})

test('does not publish an upload with equal size but different bytes', async () => {
  const { state, client } = fixture()
  const upload = client.upload
  client.upload = async (file) => {
    await upload(file)
    state.assets.at(-1).digest = 'sha256:wrong'
  }
  await assert.rejects(publishRelease(metadata, artifacts, client, noDelay), /verification failed/)
  assert.equal(state.published, 0)
})

test('does not change a release belonging to a different commit', async () => {
  const { state, client } = fixture()
  state.release.target_commitish = 'b'.repeat(40)
  await assert.rejects(publishRelease(metadata, artifacts, client, noDelay), /requested commit/)
  assert.deepEqual(state.uploaded, [])
  assert.deepEqual(state.deleted, [])
  assert.equal(state.published, 0)
})

test('does not remove an already published file when a rerun has different bytes', async () => {
  const { state, client } = fixture({
    draft: false,
    assets: [{ ...artifacts[0], id: 11, state: 'uploaded', digest: 'sha256:different' }]
  })
  await assert.rejects(publishRelease(metadata, artifacts, client, noDelay), /Refusing to replace/)
  assert.deepEqual(state.deleted, [])
  assert.deepEqual(state.uploaded, [])
})

test('rechecks every asset before publication and after a lost publish response', async () => {
  const { state, client } = fixture()
  const publish = client.publish
  client.publish = async () => {
    await publish()
    throw new Error('response lost')
  }
  await publishRelease(metadata, artifacts, client, noDelay)
  assert.equal(state.published, 1)
  assert.equal(state.release.draft, false)

  const failure = fixture()
  const getRelease = failure.client.getRelease
  failure.client.getRelease = async () => {
    if (failure.state.uploaded.length === artifacts.length) failure.state.assets.pop()
    return getRelease()
  }
  await assert.rejects(
    publishRelease(metadata, artifacts, failure.client, noDelay),
    /Final verification failed/
  )
  assert.equal(failure.state.published, 0)
})
