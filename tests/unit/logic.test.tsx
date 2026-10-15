// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageContent, plainPreview } from '@/components/chat/Markdown'
import { displayToTokens, tokensToDisplay, type Mentionable } from '@/components/chat/chatContext'
import { hasPerm, highestRole, topPosition, type PermContext } from '@/lib/perms'
import { errorMessage } from '@/lib/errors'
import { comboFromEvent, matchCombo } from '@/lib/keys'
import { formatBytes, initials, safeFileName, sameDay } from '@/lib/format'
import { validateImage } from '@/lib/media'
import type { Member, Role, Server } from '@/lib/types'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const resolver = {
  user: (id: string) => (id === U1 ? { name: 'Ana' } : id === U2 ? { name: 'Bruno' } : null),
  role: (id: string) => (id === R1 ? { name: 'Moderador', color: '#00ff00' } : null),
}

describe('Markdown seguro', () => {
  it('renderiza negrito, itálico, código, links e menções', () => {
    const html = renderToStaticMarkup(
      <MessageContent resolver={resolver} text={`**ok** *it* \`x\` https://a.com <@${U1}> <@&${R1}> @everyone`} />,
    )
    expect(html).toContain('<strong>ok</strong>')
    expect(html).toContain('<em>it</em>')
    expect(html).toContain('<code>x</code>')
    expect(html).toContain('href="https://a.com"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
    expect(html).toContain('@Ana')
    expect(html).toContain('@Moderador')
    expect(html).toContain('@everyone')
  })

  it('não executa HTML nem javascript: nas mensagens (XSS)', () => {
    const html = renderToStaticMarkup(<MessageContent resolver={resolver} text={'<img src=x onerror=alert(1)> <script>alert(1)</script> javascript:alert(1)'} />)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('href="javascript:')
  })

  it('blocos de código e citações', () => {
    const html = renderToStaticMarkup(<MessageContent resolver={resolver} text={'> citado\n```\nlinha1\nlinha2\n```'} />)
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<pre><code>linha1\nlinha2</code></pre>')
  })

  it('usuário desconhecido em menção não quebra', () => {
    const html = renderToStaticMarkup(<MessageContent resolver={resolver} text={'<@99999999-9999-4999-8999-999999999999>'} />)
    expect(html).toContain('usuário desconhecido')
  })

  it('prévia em texto simples', () => {
    expect(plainPreview(`oi <@${U1}> **negrito** \`\`\`code\`\`\``, resolver)).toBe('oi @Ana negrito [código]')
    expect(plainPreview('a'.repeat(200), undefined, 10)).toHaveLength(11)
  })
})

describe('conversão de menções', () => {
  const items: Mentionable[] = [
    { id: U1, kind: 'user', name: 'Ana', username: 'ana' },
    { id: U2, kind: 'user', name: 'Anabela', username: 'anabela' },
    { id: R1, kind: 'role', name: 'Moderador' },
  ]
  it('@usuario vira token e não confunde prefixos', () => {
    expect(displayToTokens('oi @ana e @anabela!', items)).toBe(`oi <@${U1}> e <@${U2}>!`)
    expect(displayToTokens('email a@ana.com', items)).toBe('email a@ana.com')
  })
  it('cargos e ida/volta', () => {
    const t = displayToTokens('chamando @Moderador', items)
    expect(t).toBe(`chamando <@&${R1}>`)
    expect(tokensToDisplay(t, items)).toBe('chamando @Moderador')
    expect(tokensToDisplay(`<@${U1}>`, items)).toBe('@ana')
  })
})

describe('permissões no cliente (apenas UI)', () => {
  const server = { id: 's', owner_id: 'owner' } as Server
  const roles: Role[] = [
    { id: 'def', server_id: 's', name: 'Membro', color: '#fff', position: 0, permissions: ['send_messages'], is_default: true },
    { id: 'mod', server_id: 's', name: 'Mod', color: '#0f0', position: 50, permissions: ['kick_members'], is_default: false },
    { id: 'adm', server_id: 's', name: 'Adm', color: '#f00', position: 100, permissions: ['administrator'], is_default: false },
  ]
  const member = (id: string, rs: string[]): Member => ({ server_id: 's', user_id: id, nickname: null, joined_at: '', profile: null, member_roles: rs.map((r) => ({ role_id: r })) })
  const ctx = (m: Member): PermContext => ({ server, roles, member: m })

  it('dono tem tudo; administrador tem tudo; membro só o padrão', () => {
    expect(hasPerm(ctx(member('owner', [])), 'ban_members')).toBe(true)
    expect(hasPerm(ctx(member('a', ['adm'])), 'ban_members')).toBe(true)
    expect(hasPerm(ctx(member('m', [])), 'send_messages')).toBe(true)
    expect(hasPerm(ctx(member('m', [])), 'kick_members')).toBe(false)
    expect(hasPerm(ctx(member('k', ['mod'])), 'kick_members')).toBe(true)
    expect(hasPerm(undefined, 'x')).toBe(false)
  })
  it('hierarquia', () => {
    expect(topPosition(ctx(member('owner', [])))).toBe(Number.MAX_SAFE_INTEGER)
    expect(topPosition(ctx(member('k', ['mod'])))).toBe(50)
    expect(topPosition(ctx(member('m', [])))).toBe(0)
    expect(highestRole(roles, member('x', ['mod', 'adm']))?.id).toBe('adm')
  })
})

describe('utilitários', () => {
  it('mensagens de erro compreensíveis', () => {
    expect(errorMessage({ message: 'rate_limited' })).toMatch(/Muitas ações/)
    expect(errorMessage({ message: 'new row violates row-level security policy' })).toMatch(/permissão/)
    expect(errorMessage({ message: 'Invalid login credentials' })).toMatch(/incorretos/)
    expect(errorMessage({ message: 'invite_invalid' })).toMatch(/Convite/)
    expect(errorMessage(new Error('TypeError: Failed to fetch'))).toMatch(/Sem conexão/)
    expect(errorMessage(undefined)).toMatch(/Algo deu errado/)
  })
  it('atalhos de teclado', () => {
    const e = new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, shiftKey: true })
    expect(comboFromEvent(e)).toBe('Ctrl+Shift+M')
    expect(matchCombo(e, 'Ctrl+Shift+M')).toBe(true)
    expect(matchCombo(e, 'Ctrl+M')).toBe(false)
  })
  it('formatação', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(initials('Ana Souza')).toBe('AS')
    expect(safeFileName('../../etc/pass wd.png')).not.toContain('/')
    expect(sameDay('2026-01-01T10:00:00', '2026-01-01T23:00:00')).toBe(true)
  })
  it('validação de imagens de perfil', () => {
    expect(validateImage(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull()
    expect(validateImage(new File(['x'], 'a.exe', { type: 'application/x-msdownload' }))).toMatch(/Formato/)
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'a.png', { type: 'image/png' })
    expect(validateImage(big)).toMatch(/grande/)
  })
})
