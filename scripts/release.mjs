// Publica uma versão nova: sobe o número, commita, cria a tag, envia e dispara o instalador.
//
//   npm run release -- patch        (0.2.0 -> 0.2.1)   também: minor | major | 1.4.0
//   npm run release -- patch --dry  (só mostra o que faria)
//
// Pré-requisitos: árvore git limpa, branch main e GITHUB_TOKEN em .tokens.env (com permissão de Actions).
// O app web (Vercel) se atualiza pelo push; o desktop pelo instalador/updater do GitHub Releases.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [, , bump = 'patch', ...flags] = process.argv
const dry = flags.includes('--dry')
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))

if (run('git', ['status', '--porcelain'])) throw new Error('Há alterações não commitadas. Commite antes de lançar uma versão.')
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') throw new Error(`Lançamentos saem da main (você está em "${branch}").`)

const pkg = readJson('package.json')
const [maj, min, pat] = pkg.version.split('.').map(Number)
const next = /^\d+\.\d+\.\d+$/.test(bump) ? bump : bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : bump === 'patch' ? `${maj}.${min}.${pat + 1}` : null
if (!next) throw new Error('Use: patch, minor, major ou um número como 1.4.0')
const tag = `v${next}`
console.log(`Versão ${pkg.version} -> ${next} (${tag})${dry ? ' [simulação]' : ''}`)
if (dry) process.exit(0)

const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, 'utf8')))
edit('package.json', (s) => s.replace(`"version": "${pkg.version}"`, `"version": "${next}"`))
edit('package-lock.json', (s) => s.replace(`"version": "${pkg.version}"`, `"version": "${next}"`).replace(new RegExp(`("name": "[^"]+",\\s*"version": )"${pkg.version}"`), `$1"${next}"`))
edit('src-tauri/tauri.conf.json', (s) => s.replace(/("version":\s*)"[^"]+"/, `$1"${next}"`))
edit('src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]+"/m, `version = "${next}"`))

run('git', ['add', '-A'])
run('git', ['commit', '-m', `Versão ${next}`])
run('git', ['tag', tag])
run('git', ['push', 'origin', 'main'])
run('git', ['push', 'origin', tag])
console.log('Enviado. O site (Vercel) atualiza sozinho em ~1 min.')

// Eventos de tag nem sempre disparam o Actions neste repositório: dispara o workflow explicitamente.
const token = (readFileSync('.tokens.env', 'utf8').match(/^GITHUB_TOKEN=(.+)$/m) ?? [])[1]?.trim()
if (token) {
  const res = await fetch('https://api.github.com/repos/luigizanella/vibe-chat/actions/workflows/release-desktop.yml/dispatches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ ref: tag }),
  })
  console.log(res.status === 204 ? 'Instalador do Windows: build iniciado no GitHub Actions (~10-15 min).' : `Não consegui disparar o build (HTTP ${res.status}). Rode o workflow "Release desktop" manualmente na tag ${tag}.`)
} else console.log('Sem GITHUB_TOKEN em .tokens.env: dispare o workflow "Release desktop" manualmente na tag.')
