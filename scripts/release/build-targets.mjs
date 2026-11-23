import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// The single list of what a release builds and must contain. The workflow's build matrix and
// the publisher's asset check both come from here. Keep the names aligned with
// electron-builder.yml.
const TARGETS = [
  {
    name: 'macOS',
    os: 'macos-15',
    build_command: 'yarn build:mac',
    artifact_name: 'macos',
    release_asset_prefix: 'league-akari-mac-arm64',
    cache_path: '~/Library/Caches/electron\n~/Library/Caches/electron-builder',
    artifact_paths: 'dist/*.dmg\ndist/*.zip',
    requiredAssets: ['league-akari-mac-arm64.dmg', 'league-akari-mac-arm64.zip'],
    optionalAssets: []
  },
  {
    name: 'Windows',
    os: 'windows-2022',
    build_command: 'yarn build:win',
    artifact_name: 'windows',
    release_asset_prefix: 'league-akari-win-x64',
    cache_path: '~\\AppData\\Local\\electron\\Cache\n~\\AppData\\Local\\electron-builder\\Cache',
    artifact_paths: 'dist/*.7z\ndist/*.exe',
    requiredAssets: ['league-akari-win-x64.7z'],
    optionalAssets: ['league-akari-win-x64.exe']
  }
]

const DEV_REF = 'refs/heads/dev'

/**
 * Dev prereleases are Windows only. GitHub's hosted macOS runners are sometimes unavailable
 * for a long time ("The job was not acquired by Runner"), and with macOS in the matrix every
 * such outage left dev without any release although the Windows package had been built.
 * Version tags still build and require every platform.
 */
export function selectBuildTargets(ref) {
  if (!ref) throw new Error('A git ref is required to select build targets')
  return TARGETS.filter((target) => ref !== DEV_REF || target.name === 'Windows')
}

/** The matrix of the workflow's build job. */
export function buildMatrix(ref) {
  return {
    include: selectBuildTargets(ref).map(({ requiredAssets, optionalAssets, ...job }) => job)
  }
}

/** The files a release of this ref must contain, and the ones it may contain. */
export function releaseAssets(ref) {
  const targets = selectBuildTargets(ref)
  const required = targets.flatMap((target) => target.requiredAssets)
  return {
    required,
    allowed: [...required, ...targets.flatMap((target) => target.optionalAssets)]
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const matrix = buildMatrix(process.env.GITHUB_REF)
  if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GITHUB_OUTPUT')
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`)
  console.log(`Build targets: ${matrix.include.map((target) => target.name).join(', ')}`)
}
