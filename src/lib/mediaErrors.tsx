import { isTauri } from './env'
import { isMac, isSafari } from './diag'
import { toast, useUI } from '@/store/ui'
import { Modal, useCloseModal } from '@/components/ui'

export type MediaKind = 'microphone' | 'camera' | 'screen' | 'speaker'
export type MediaProblem = 'denied' | 'notfound' | 'busy' | 'overconstrained' | 'unsupported' | 'cancelled' | 'other'

const LABEL: Record<MediaKind, { nome: string; artigo: string }> = {
  microphone: { nome: 'microfone', artigo: 'o' },
  camera: { nome: 'câmera', artigo: 'a' },
  screen: { nome: 'compartilhamento de tela', artigo: 'o' },
  speaker: { nome: 'saída de áudio', artigo: 'a' },
}

export function classifyMediaError(e: unknown): MediaProblem {
  const name = (e as { name?: string })?.name ?? ''
  const msg = String((e as { message?: string })?.message ?? '')
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /permission denied|not allowed/i.test(msg)) return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'notfound'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError' || /could not start|in use/i.test(msg)) return 'busy'
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'overconstrained'
  if (name === 'NotSupportedError' || name === 'TypeError') return 'unsupported'
  return 'other'
}

function windowsPrivacyPage(kind: MediaKind): string {
  return kind === 'camera' ? 'Câmera' : kind === 'microphone' ? 'Microfone' : 'Câmera/Microfone'
}

/** Passos para liberar a permissão, de acordo com onde o app está rodando. */
export function permissionSteps(kind: MediaKind): string[] {
  if (kind === 'screen') {
    if (isMac())
      return [
        'Abra o menu Apple, Ajustes do Sistema, Privacidade e Segurança, Gravação de Tela (em versões antigas: Preferências do Sistema, Segurança e Privacidade, Privacidade, Gravação de Tela).',
        `Ligue a chave de ${isSafari() ? 'Safari' : 'seu navegador (Chrome, Edge, Arc…)'}. Se ele não estiver na lista, volte ao app e tente compartilhar uma vez para ele aparecer.`,
        'Reinicie o navegador por completo (Cmd+Q) e abra o Vibe Chat de novo.',
        isSafari() ? 'No Safari, clique no botão de compartilhar de novo logo depois de abrir a chamada; ele só abre o seletor em resposta direta a um clique.' : 'Depois de reiniciar, clique em Tela e escolha a tela, janela ou aba.',
      ]
    return isTauri
      ? ['Clique em “Tela” de novo e, na janela do Windows, escolha a tela ou janela e confirme em “Compartilhar”.', 'Se a janela do Windows não aparecer, feche o Vibe Chat pelo ícone da bandeja (botão direito → Sair) e abra de novo.']
      : ['Clique em “Tela” de novo e escolha a tela, janela ou aba no seletor do navegador, depois “Compartilhar”.', 'Se o seletor não aparece, clique no cadeado ao lado do endereço → Configurações do site → permita “Compartilhamento de tela”, e recarregue a página (F5).']
  }
  const pagina = windowsPrivacyPage(kind)
  const alvo = kind === 'camera' ? 'a câmera' : 'o microfone'
  if (isTauri)
    return [
      `Abra o Windows: Configurações → Privacidade e segurança → ${pagina}.`,
      `Ligue “Acesso ${kind === 'camera' ? 'à câmera' : 'ao microfone'}” e “Permitir que aplicativos da área de trabalho acessem ${alvo}”.`,
      'Feche o Vibe Chat pelo ícone da bandeja (botão direito → Sair) e abra de novo.',
      'Se ainda falhar: outro programa (Teams, Zoom, OBS) pode estar usando o dispositivo — feche-o.',
    ]
  return [
    `Clique no cadeado (ou no ícone de ${kind === 'camera' ? 'câmera' : 'microfone'}) ao lado do endereço do site.`,
    `Em “Configurações do site”, mude ${kind === 'camera' ? 'Câmera' : 'Microfone'} para “Permitir”.`,
    'Recarregue a página (F5) e tente de novo.',
    'Se o navegador nem pergunta: veja se o Windows permite o acesso em Configurações → Privacidade e segurança.',
  ]
}

function HelpModal({ kind, problem }: { kind: MediaKind; problem: MediaProblem }) {
  const close = useCloseModal()
  const { nome } = LABEL[kind]
  const steps = permissionSteps(kind)
  const title =
    kind === 'screen' ? 'Não foi possível compartilhar a tela' : problem === 'busy' ? `Não foi possível usar ${LABEL[kind].artigo} ${nome}` : `Permissão negada para ${LABEL[kind].artigo} ${nome}`
  return (
    <Modal title={title} footer={<button className="btn btn-primary" onClick={close}>Entendi</button>}>
      <p className="mt-0 text-fg-2">
        {problem === 'busy'
          ? `O dispositivo está em uso por outro programa ou aba. Feche o outro programa e tente de novo.`
          : `O ${isTauri ? 'Windows ou o app' : 'navegador'} não deixou o Vibe Chat usar ${LABEL[kind].artigo} ${nome}. Para liberar:`}
      </p>
      {problem !== 'busy' && (
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-fg-2">
          {steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      )}
      {problem !== 'busy' && <button className="btn btn-sm mt-3" onClick={() => void navigator.clipboard.writeText(steps.map((s, i) => `${i + 1}. ${s}`).join('\n')).then(() => toast.success('Passo a passo copiado.'))}>Copiar passo a passo</button>}
      <p className="hint mt-4">Você continua na chamada e pode ouvir os outros. Nada é capturado sem a sua permissão.</p>
    </Modal>
  )
}

let lastShown = 0

/** Mostra uma mensagem clara (e, quando faz sentido, um passo a passo) para falhas de mídia. */
export function reportMediaError(e: unknown, kind: MediaKind): MediaProblem {
  const problem = classifyMediaError(e)
  const { nome, artigo } = LABEL[kind]
  const now = Date.now()
  if (now - lastShown < 1500) return problem // evita modais/toasts duplicados em sequência
  lastShown = now
  if (kind === 'screen' && (problem === 'denied' || problem === 'cancelled')) {
    // resposta instantânea = o seletor nem chegou a abrir (permissão do sistema ou gesto perdido); demorada = a pessoa cancelou
    const ms = (e as { ms?: number })?.ms
    if (ms !== undefined && ms < 700) {
      useUI.getState().openModal(<HelpModal kind="screen" problem="denied" />)
      return 'denied'
    }
    toast.info('Compartilhamento de tela cancelado.')
    return 'cancelled'
  }
  if (kind === 'screen' && problem === 'unsupported') {
    toast.error('Este navegador não consegue compartilhar a tela. Use o Chrome ou o Edge.')
    return problem
  }
  if (problem === 'denied' || problem === 'busy') useUI.getState().openModal(<HelpModal kind={kind} problem={problem} />)
  else if (problem === 'notfound') toast.error(`Nenhum${kind === 'camera' || kind === 'speaker' ? 'a' : ''} ${nome} encontrad${kind === 'camera' || kind === 'speaker' ? 'a' : 'o'}. Conecte um dispositivo e escolha-o em Configurações → Voz e vídeo.`)
  else if (problem === 'overconstrained') toast.error(`O dispositivo escolhido para ${artigo} ${nome} não está disponível. Usando o padrão do sistema.`)
  else if (problem === 'unsupported') toast.error(`Este navegador/sistema não suporta ${artigo} ${nome}.`)
  else toast.error(`Falha ao acessar ${artigo} ${nome}.`)
  return problem
}

/** Estado das permissões (quando o navegador informa) para exibir nas configurações. */
export async function queryMediaPermissions(): Promise<{ microphone: PermissionState | 'unknown'; camera: PermissionState | 'unknown' }> {
  const ask = async (name: string): Promise<PermissionState | 'unknown'> => {
    try {
      return (await navigator.permissions.query({ name: name as PermissionName })).state
    } catch {
      return 'unknown'
    }
  }
  return { microphone: await ask('microphone'), camera: await ask('camera') }
}
