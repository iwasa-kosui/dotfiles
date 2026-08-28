# web-fetch CLI 設計

## 背景

WebFetch ツールの呼び出しには毎回確認プロンプトが出ます。組織配信の設定でこのツールが確認対象になっており、ユーザー側の設定では解除できません。公開ドキュメントを読むだけの操作で確認が頻発し、作業が中断します。

さらに builtin の WebFetch は取得したページを小型モデルで要約して返します。仕様やリファレンスを正確に読みたい場合、要約は劣化した入力になります。

Bash 経由の取得も既存の deny ルールで塞がれています。`Bash(curl *)` と `Bash(wget *)` が `~/.claude/remote-settings.json:75-76` で deny されています。

## 目的

許可したドメインに限り、確認プロンプトなしに Web ページを取得し、Markdown 全文を標準出力に返すコマンドを用意します。

## コマンドの仕様

`web-fetch <url>`

標準出力に Markdown、標準エラーに拒否理由を出します。オプションは設けません。フラグを増やすと `Bash(web-fetch:*)` で許可する範囲が広がり、後から絞りにくくなるためです。

- 終了コード `0`: 成功
- 終了コード `1`: 取得失敗または HTTP エラー
- 終了コード `2`: 許可判定で拒否
- 終了コード `3`: 引数不正

## 許可判定

`~/.config/web-fetch/allowlist` を読み、1行1ドメインで照合します。`#` 始まりの行と空行は無視します。

- 先頭に `.` が無い行は完全一致です。
- 先頭に `.` がある行は、そのドメインとサブドメインの両方に一致します。`.github.com` は `github.com` と `api.github.com` に一致します。

拒否したときは許可されているドメインの一覧を標準エラーに出します。呼び出し側が次の手を判断できるようにするためです。

初期の allowlist:

- code.claude.com
- docs.anthropic.com
- www.anthropic.com
- .github.com
- raw.githubusercontent.com
- developer.mozilla.org
- nodejs.org
- bun.sh
- www.typescriptlang.org
- registry.npmjs.org
- cybozu.dev
- developer.atlassian.com
- support.atlassian.com

社内の `*.atlassian.net` は含めません。認証付きで扱う領域は `jira` / `confluence` CLI の担当であり、認証なしで叩く経路を作る理由がないためです。

## 取得

URL スキームは `http` と `https` のみ許可します。

ホスト名に対して SSRF 判定をかけます。`dot_claude/hooks/executable_webfetch-guard.ts:35-51` と同じ条件を使います。

- `localhost` `127.0.0.1` `0.0.0.0` `::1` の完全一致を拒否します。
- `10.x` `172.16-31.x` `192.168.x` を拒否します。
- 末尾が `.internal` `.local` `.corp` のものを拒否します。

リダイレクトは `redirect: "manual"` で自前に追い、ホップごとに許可判定と SSRF 判定をやり直します。`fetch` の既定の追跡に任せると、許可ドメインから許可外へ転送された先の内容を無検査で出力してしまいます。上限は5ホップです。

タイムアウトは30秒、レスポンスの上限は5MBです。Cookie と認証ヘッダは送りません。

## Markdown 変換

`Content-Type` で分岐します。HTML 以外は変換せず body をそのまま出します。JSON や Markdown を無駄に加工しないためです。

HTML の場合は `<main>` → `<article>` → `<body>` の順に本文候補を選び、`script` `style` `nav` `header` `footer` `aside` を除去してから変換します。ナビゲーションを含めると読み手のトークンを消費するだけになるためです。

依存は `turndown` と `turndown-plugin-gfm` です。turndown 単体はテーブルを変換できず、参照するドキュメントの多くが表を含むためプラグインが必要です。

## ファイル構成

| パス | 役割 |
|---|---|
| `dot_local/bin/executable_web-fetch` | shebang と `runCli` 呼び出しのみ。`dot_local/bin/executable_rpt:1-4` と同型 |
| `dot_local/lib/web-fetch/src/cli.ts` | 引数解釈、全体の流れ、終了コードの決定 |
| `dot_local/lib/web-fetch/src/allowlist.ts` | allowlist の読み込みと照合 |
| `dot_local/lib/web-fetch/src/guard.ts` | SSRF 判定 |
| `dot_local/lib/web-fetch/src/fetch.ts` | リダイレクト追跡、サイズ上限、タイムアウト |
| `dot_local/lib/web-fetch/src/markdown.ts` | HTML から Markdown への変換 |
| `dot_config/web-fetch/allowlist` | 許可ドメインの正本 |

`guard.ts` は `dot_claude/hooks/executable_webfetch-guard.ts` と同じ判定内容になります。デプロイ先が `~/.local/lib/` と `~/.claude/hooks/` に分かれるため import で共有できません。`dot_claude/hooks/branch-guard-lib.ts:1-3` と同じ形式で、両方を同一内容に保つ旨を先頭コメントに書きます。

## 権限設定

`dot_claude/modify_settings.json.tmpl` の `permissions.allow` に `Bash(web-fetch:*)` を追加します。このテンプレートは `jq '. * $managed'` で配列を丸ごと上書きするため、`~/.claude/settings.json` を直接編集しても `chezmoi apply` で消えます。

## テスト

`tests/web-fetch-*.test.ts` に置き `bun test` で実行します。判定ロジックを純関数に切り出し、`fetch` は差し替え可能にしてネットワークなしで検証します。

検証項目:

- allowlist のパースと照合。完全一致、先頭 `.` のサブドメイン一致、コメント行と空行、許可外
- SSRF 判定。localhost、プライベート IP の各レンジ、`.internal` 系、通常のドメイン
- リダイレクト。許可ドメインから許可外への転送の拒否、ホップ上限、SSRF 対象への転送の拒否
- Markdown 変換。見出し、リンク、表、`script` の除去、`<main>` の選択、HTML 以外の素通し

## 受け入れる制約

許可ドメインが攻撃者の制御下で内部 IP に解決される DNS リバインディングは防げません。ホスト名の文字列判定だけを行い、解決後の IP を見ないためです。allowlist に載せるのは信頼するドメインだという前提で受け入れます。

`<main>` の抽出は正規表現で行います。`<main>` が入れ子になっている文書では正しく取れません。実際の文書で入れ子は稀なため許容します。
