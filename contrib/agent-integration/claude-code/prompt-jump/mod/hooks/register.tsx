// niwatermの目次から選ばれたプロンプトへ、Claude Codeのtranscriptの表示を移す。
//
// transcriptの行を動かせるのは「人の操作に応えている間」だけで、タイマーや通知から呼ぶと
// engineが弾く（`deny: "not person-initiated"`）。そのためniwaterm側はジャンプ先を
// タブ変数へ置いてからキーを送り、このButtonの押下として受け取る。
//
// プロンプト行のrequestIdはtranscript（jsonl）のuuidと、ツール行（AskUserQuestion等）の
// requestIdはtool_useのidと同じ値なので、niwatermが`niwa claude prompt list`で
// 見せている一覧の値をそのまま渡せる。

import type { Hook, Register } from 'claude-code'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** niwatermがジャンプ先のプロンプトのuuidを書き込むタブ変数 */
const JUMP_VAR = 'agent_jump'

async function pendingTarget($: Dollar, cli: string): Promise<string> {
  const ran = await $.process.run([cli, 'tab', 'var', 'get', JUMP_VAR])

  return ran.exitCode === 0 ? ran.stdout.trim() : ''
}

async function jumpToPending($: Dollar, cli: string): Promise<void> {
  const target = await pendingTarget($, cli)
  if (target === '') {
    $.ui.toast('niwaterm: ジャンプ先が読めませんでした')

    return
  }
  const result = await $.ui.scroll({ to: { requestId: target }, block: 'start' })
  if (result.deny !== undefined) {
    $.ui.toast(`niwaterm: ${result.deny}`)
  }
}

export const register: Register = (on, options) => {
  const cli = String(options.cli ?? 'niwa')
  const action = String(options.action ?? 'app:openArtifact')

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Buttonはマウントされている間だけactionのキーを拾うので、帯そのものは常に返す。
    // `display: "none"`なら画面には1行も出ないまま押せる状態を保てる。
    // アンケートが帯を使っている間はそちらへ譲る
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box display="none">
        <Button key="niwaterm-jump" label="niwaterm" action={action} onPress={() => jumpToPending($, cli)} />
      </Box>
    )
  })
}
