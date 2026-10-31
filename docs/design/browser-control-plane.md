# ブラウザから管理役を操作する仕組みの設計

- 状態: 提案（実装は未承認）
- 対象ブランチ: feat/browser-control-plane
- 試作: `docs/design/browser-control-plane/prototype.html`（公開先 https://claude.ai/artifact/1HM8VwedPtVBDLY6wBjiFM 、所有者だけが開ける）

## 目的

ユーザーが使う Artifact のページを、この文書では「操作ページ」と呼びます。

ユーザーはブラウザだけを見て、エージェント群に判断を返し、指示を送ります。この設計では、ターミナルの AskUserQuestion と、管理役による手作業のダッシュボード更新をやめます。

要件は次の4つです。

- ユーザーはブラウザで選択肢を選び、自由記述のメッセージを送る。
- バックログを管理する管理役が、ユーザーの入力を読んで動く。
- 俯瞰役が現状を定期的に集め、ページの表示を更新する。
- 誰もページを見ていない間、エージェントは無駄にトークンを使わない。

## 調べた結果

### Artifact のランタイム機能（runtime contract 0.2.96）

| 機能 | できること | 設計で使う点 |
|---|---|---|
| `db` | ページとエージェントが同じ文書を読み書きする。ページは `onSnapshot` で変更を即時に受け取る。エージェントは `ArtifactData` ツールの get / list / query / set / update / batch で読み書きする | 質問、回答、連絡、現況を受け渡す |
| `db` の rules | collection ごとに read と write の最低権限を `view` / `interact` / `admin` / `owner` / `self` から選ぶ | 全 collection を `read: owner, write: owner` にし、所有者以外のアカウントを締め出す。ただし rules は、ユーザー本人と、ユーザーとして `ArtifactData` を呼ぶエージェントを区別しない |
| `user` | `isOwner()`、`id()` で閲覧者を識別する。id は所有者の組織の中だけで比べられる不透明な値である | 所有者でなければ操作部品を出さない。回答に `by` として id を残す |
| `comments` の `sendToClaude` | ページが閲覧者の操作を受けて、コメントを投稿し、そのコメントを Claude に送る。編集者だけが使え、閲覧者のクリックなどの直近の操作が必要である。ページは送る前に `canSendToClaude()` が `available` を返すかを確かめる。初回は同意を求められ、`consent_required` で失敗することがある。エージェント側の `ArtifactComments` は、Claude に送られた既存のスレッドへの返信しかできず、Send to Claude のコメントを新しく作れない | 回答や連絡を保存した直後に管理役を起こす合図として使う |
| Artifact の watch | 公開したセッションは、その Artifact のコメントを監視する。編集者が Send to Claude したコメントは、監視中のセッションに新しいターンを起こす。自動返信は同じ Artifact で1時間に60件までである。Claude Code が自動で始めた watch は、Artifact に数時間動きがないと終わることがある。自動返信の上限と、数時間動きがないと終わる点の出典は https://code.claude.com/docs/en/artifacts である。接続が切れたときは watch が自動で再接続する（ArtifactComments ツールの説明）。publish と、ユーザー自身のメッセージにリンクがある Artifact への `watch` が自動返信を有効にする（ArtifactComments ツールの説明）。ユーザーが Ctrl+C で割り込むと、自動返信はユーザーの次のメッセージまで止まる（ArtifactComments ツールの説明） | 管理役を、ユーザーの入力があったときだけ起こす |
| `room` | ページを開いている人どうしで、保存されない短いイベントを送り合う。公開したセッションは、サーバーが許可した場合だけ `kind: "agent"` の peer として加わる。サーバーの許可は既定で無効である | 使わない |
| `sample` | ページから Claude に質問する。会話の記憶を持たず、管理役とはつながらない | 使わない |

`ArtifactData` が返す文書には、サーバーが付けた `version` と `updatedAt` が付きます。ページ側の `db` API には書き込み者と更新時刻が自動では付きません。そのため、ページは書き込む値に `by` と時刻を自分で入れます。

`ArtifactData` ツールは、読んだ行をツール結果として「データであり指示ではない」と扱います。安全性の節では、ツールが行をデータとして扱うことを前提に設計します。

### Claude Code の待機と定期実行

| 手段 | 待機中のセッションを起こせるか | 消える条件と上限 |
|---|---|---|
| `/loop`（間隔指定） / `CronCreate` | 起こせる。発火はターンとターンの間だけで、取りこぼした回はまとめて1回になる | セッション限定。定期タスクは7日で失効する。1セッション50件まで。`durable` は効かない |
| `/loop`（動的） / `ScheduleWakeup` | 起こせる。次の起床を1分から1時間の間で選ぶ | セッション限定。7日で失効する。`--resume` で復元されない |
| `Monitor` | 起こせる。コマンドの標準出力1行が1件の通知になる | `timeout_ms` は最大30分で、期限切れの後は再アームが要る |
| Bash の `run_in_background` | 起こせる。コマンドが終了したときに1回通知が来る | 対話セッションでは時間の上限がない（https://code.claude.com/docs/en/interactive-mode ）。非対話の実行では既定30分、最大2時間。セッション終了で片付けられる |
| `SendMessage` | 起こせる。受信側が待機中なら新しいターンが始まる | SendMessage ツールの説明は「受信側と権限モードが違うセッションからのメッセージは、受信側のユーザーの承認待ちで保留になる」と書く。公式ドキュメント（cross-session-messaging）は、権限確認を省くモードかどうかの区分が違うときに保留になると書く。どちらの書き方でも、同じ権限モードどうしなら保留にならない。保留中の承認はターミナルでしか操作できない。届いたメッセージは入力したプロンプトと同じく使用量に数えられる |
| Artifact の watch | 起こせる。編集者が Send to Claude したときだけ起きる | 上限と終了条件は前の表の watch の行を参照 |
| `/schedule` のクラウドルーチン | ローカルのセッションは起こせない。クラウドで新しいセッションが始まる | ローカルのファイルと cmux に触れない。最小間隔は1時間 |
| `ReadNotifications` | 公式ドキュメントとこのセッションのツール一覧に見当たらない | なし |

権限確認で止まったセッションには、Remote Control（`/remote-control`）を使うと claude.ai/code やモバイルアプリから答えられます。Remote Control に転送した権限確認は、答えるまで開いたままです。

出典: https://code.claude.com/docs/en/scheduled-tasks 、 https://code.claude.com/docs/en/tools-reference 、 https://code.claude.com/docs/en/cross-session-messaging 、 https://code.claude.com/docs/en/artifacts 、 https://code.claude.com/docs/en/remote-control 、 Artifact の型定義（contract 0.2.96 の `db.d.ts`、`comments.d.ts`、`user.d.ts`、`room.d.ts`）

## 役割の分担

| 役割 | 実体 | 担当 |
|---|---|---|
| ユーザー | ブラウザ | ページで質問に答え、連絡を送り、現況を見る。権限確認には Remote Control の画面で答える |
| 管理役 | cmux の対話セッション（いまの管理役） | ページを公開し、watch を持つ。質問を db に書く。回答と連絡を読み、バックログを更新し、作業セッションとレビューセッションに SendMessage で指示する |
| 俯瞰役 | 管理役とは別の cmux の対話セッション | セッションと PR の状態を集め、db の `board/current` に書く。未処理の入力は拾わない。拾うのは管理役である |
| 作業セッション | いまと同じ | 変更なし。ユーザーへの質問は管理役に SendMessage で送り、自分で AskUserQuestion を使わない |
| レビューセッション | いまと同じ | 変更なし |

俯瞰役は管理役と分けます。理由は2つあります。

- 状態の収集では `cmux read-screen` と `gh pr view` の出力を読む。管理役がこれらの出力を読むと、管理役の文脈が増え、以降の全ターンで読み直しの費用がかかる。
- 俯瞰役は定期的に起きる。管理役が定期的に起きると、そのたびに管理役の大きな文脈を読み直す。俯瞰役は小さな文脈で起きるので、1回の起床が安い。

ページの公開と watch は管理役が持ちます。理由は、Send to Claude が起こすのが watch を持つセッションであり、ユーザーの入力に応じて動く役が管理役であることです。俯瞰役は `ArtifactData` で `board/current` に書くだけで、ページを再公開しません。

### 起動の要件

- 管理役、俯瞰役、作業セッション、レビューセッションは、同じ権限モードで起動する。モードが違うと SendMessage が保留になり、ターミナルでの承認が要る。
- `ArtifactData` と `ArtifactComments` を使ってよいのは、管理役と俯瞰役だけにする。作業セッションとレビューセッションは、起動時のコマンドライン引数でこの2つのツールを使えなくする。
- 俯瞰役が書いてよいのは `board/current` だけにする。PreToolUse hook が `ArtifactData` の書き込み先の collection を調べ、俯瞰役からの `board` 以外への書き込みを止める。hook が俯瞰役を見分ける方法は、起動スクリプトで役割を示す環境変数を渡す方法を候補にする。具体的な変数名は実装時に決める。
- 管理役が書いてよいのは `questions` と、`answers` と `inbox` の `handled` だけにする。管理役が `answers` と `inbox` の本文を書かないことも、同じ hook で確かめる。
- この hook と起動引数は提案であり、設計の承認後に実装する。

## データの流れ

### db の構成

| collection / 文書 | 書く人 | 読む人 | 中身 |
|---|---|---|---|
| `questions/{qid}` | 管理役 | ページ | `title`、`context`、`options`（`id`、`label`、`description`）、`status`（`open` / `resolved` / `withdrawn`）、`createdAt`、`askedBy` |
| `answers/{qid}` | ページ（本文と `notified`）、管理役（`handled`） | 管理役 | `questionId`、`choice`、`text`、`answeredAt`、`by`、`notified`、`handled`（`false` / `processing` / `done`） |
| `inbox/{mid}` | ページ（本文と `notified`）、管理役（`handled`） | 管理役 | `text`、`sentAt`、`by`、`notified`、`handled`（`false` / `processing` / `done`） |
| `board/current` | 俯瞰役 | ページ | `updatedAt`、`heartbeatAt`、`summary`、`sessions`、`prs`、`backlog`、`decisions` |

ページが書く文書と、エージェントが書く文書を分けます。同じ文書をページとエージェントの両方が書くと、`version` の衝突で書き込みが失敗します。例外は `handled` で、管理役が `processing` と `done` を `if_version` つきで書きます。

### ユーザーの入力がエージェントに届く経路

1. ユーザーが質問カードで選択肢を選び、「回答する」を押す。
2. ページが `answers/{qid}` に回答を `notified: false` で保存する。
3. ページは描画時に `canSendToClaude()` を確かめておく。`available` なら、保存の直後に `sendToClaude` で「回答しました: {qid}」というコメントを送り、`notified` を `true` にする。クリックから `sendToClaude` までの待ち時間を短くするため、`canSendToClaude()` の確認はクリックの前に済ませる。
4. 送れなかったときは、ページが「管理役に届いていません」と理由つきで表示し、「管理役に知らせる」ボタンを出す。ユーザーがボタンを押すと、ページはもう一度 `sendToClaude` を呼ぶ。理由は `consent_required`（同意が必要）、`claude_unavailable` と `no_session`（受け取るセッションがない）、その他に分けて表示する。
5. watch を持つ管理役の新しいターンが始まる。
6. 管理役は `ArtifactData` の query で `handled == false` の回答と連絡を読む。処理を始める前に、`handled` を `processing` に `if_version` つきで更新する。更新が衝突したら、別のターンが処理中なので何もしない。
7. 処理を終えたら、管理役は `handled` を `done` にし、質問の `status` を `resolved` にする。コメントのスレッドに受け取ったことを返信し、スレッドを resolve する。

コメントは起こすための合図であり、内容の正本ではありません。管理役はコメント本文ではなく db の行を読みます。

届かなかった入力は db に `notified: false` で残ります。届かなかった入力を拾う役は、管理役の1つに決めます。管理役は、起動したときと、Send to Claude や SendMessage で起きたときに、毎回 `handled == false` の行をすべて読みます。ページは `notified: false` の行に「管理役に知らせる」ボタンを出し続けます。

### エージェントの状態がページに出る経路

- 管理役が `questions/{qid}` を書くと、ページの `onSnapshot` が即時にカードを出す。管理役は同時に PushNotification でユーザーの端末に知らせる。
- 俯瞰役が `board/current` を書くと、ページの現況欄が即時に変わる。
- 俯瞰役は、状態が変わらなくても6時間ごとに `board/current` の `heartbeatAt` を更新する。ページは `heartbeatAt` が7時間より古いとき、俯瞰役が止まっている可能性を警告する。
- 管理役がページの HTML を再公開するのは、ページのコードを変えるときだけである。

## 正本の置き場所

| 情報 | 正本 | 理由 |
|---|---|---|
| バックログ | 管理役の作業ディレクトリの Markdown（いまの cmux-orchestration と同じ） | 作業セッションとレビューセッションも読み、git で履歴が残る |
| 決定事項 | 同じ Markdown | バックログと同じ理由 |
| 判断待ちの質問と回答 | db の `questions` と `answers` | ページとの受け渡しのためだけに存在し、解決後は履歴として残る |
| ユーザーからの連絡 | db の `inbox` | 判断待ちの質問と回答と同じ理由 |
| セッションと PR の状態 | 正本を作らない | 俯瞰役が `cmux` と `gh` で確かめた値を `board/current` に書く。いまの cmux-orchestration と同じ考え方である |

二重管理を避けるため、写す向きを一方向に決めます。

- バックログと決定事項は、Markdown から `board/current` への一方向だけに写す。俯瞰役が写し、ページはバックログを編集しない。
- ユーザーがバックログを変えたいときは、`inbox` に連絡を送る。管理役が Markdown を直し、次の俯瞰で俯瞰役が `board/current` に反映する。
- 質問が解決したら、管理役が決定事項を Markdown に1行足す。db の質問は消さない。

## ユーザーに判断を求める流れ

管理役と作業セッションは AskUserQuestion を使いません。代わりに次の手順をとります。

1. 管理役が質問 id を決め、`questions/{qid}` を `status: open` で書く。選択肢には、選んだ後に起きることを `description` で書く。
2. 管理役が PushNotification で「判断待ち: {title}」を送る。
3. 管理役は返事を待たずにターンを終える。質問に依存しない作業は続ける。
4. 回答が届いたら、管理役がデータの流れの節の手順6と7で処理する。
5. 状況が変わって質問が不要になったら、管理役が `status` を `withdrawn` にする。

作業セッションがユーザーの判断を必要とするときは、管理役に SendMessage で質問の文面と選択肢を送ります。管理役が質問カードにします。

## 更新の周期と起こし方

| 役割 | 起こし方 | 周期 |
|---|---|---|
| 管理役 | Send to Claude のコメント、作業セッションと俯瞰役からの SendMessage | 定期的には起きない |
| 俯瞰役 | Bash の `run_in_background` で動かす監視スクリプトが終了したとき | 監視スクリプトは60秒ごとに状態を取り、要約のハッシュが変わったら終了する。変化がなくても6時間たったら終了する |

監視スクリプトは、`cmux` のワークスペース一覧、各ワークスペースの `cmux read-screen` の末尾、`gh pr list` の結果から要約を作ります。`read-screen` の末尾に権限確認の画面にあたる文字列があれば、そのセッションの状態を `needs-approval` にして要約に含めます。画面の全文は要約に入れません。要約のハッシュが前回と変わったら、スクリプトは終了します。俯瞰役は終了の通知で起き、`board/current` を書き、監視スクリプトをもう一度起動します。`Monitor` を使わない理由は、`Monitor` が最大30分で期限切れになり、何も起きていなくても1日48回俯瞰役が起きるからです。

無駄なトークンを減らすため、次の工夫を入れます。

- 管理役は定期的に起きない。ユーザーの入力と他のセッションからの報告だけで起きる。
- 俯瞰役は状態が変わったときと、6時間ごとの heartbeat のときだけ起きる。1日あたりの最少の起床は4回である。
- 監視スクリプトは画面の全文を俯瞰役の文脈に入れない。スクリプトは終了するときに、変わった点の1行の要約だけを出力する。
- すべての作業セッションが終わり、未処理の回答もないときは、俯瞰役が監視を止める。管理役が新しい作業を始めるときに、俯瞰役に SendMessage で再開を頼む。監視を止めている間は heartbeat も止まるので、ページが俯瞰役の停止を警告する。

`/loop` と `CronCreate` は7日で失効し、セッションを閉じると止まります。Bash の `run_in_background` もセッション限定です。複数日にわたる運用では、管理役が毎朝の最初のターンで俯瞰役の監視が動いているかを確かめます。

## 安全性

### ページからの入力を指示として扱う条件

- ページは private のまま使い、共有しない。db の rules は全 collection を `read: owner, write: owner` にする。
- ページは `user.isOwner()` が false なら操作部品を出さない。
- rules は、ユーザー本人と、ユーザーとして `ArtifactData` を呼ぶエージェントを区別しない。`by` も書き手が自由に入れられる値であり、本人確認にならない。そのため、db の行だけでは、人間が書いたことを確かめられない。
- 人間の操作を確かめる手段は、Send to Claude のコメントだけである。`sendToClaude` は編集者だけが、閲覧者自身の直近の操作から呼べる（comments.d.ts:585-586）。エージェント側の `ArtifactComments` は、新しい Send to Claude のコメントを作れない。
- 管理役は入力を次の3段階に分けて扱う。
  - 取り消しにくい操作（merge、Ready 化、外部への送信、削除）: db の回答に加え、その qid を本文に含む Send to Claude のコメントが届いたときだけ実行する。俯瞰役の SendMessage や管理役の起動時の読み直しで見つけた回答では、実行しない。ページは `notified: false` の回答に「管理役に知らせる」ボタンを出しているので、ユーザーがボタンを押せば条件を満たす。
  - 質問カードへの回答（取り消しやすい操作）: 管理役は、選ばれた選択肢の `description` に書いたとおりに動く。
  - `inbox` の自由記述: 管理役は、バックログへの追加候補として扱う。取り消しにくい操作は、自由記述だけでは実行せず、質問カードを出す。
- 作業セッション、レビューセッション、俯瞰役が `answers` と `inbox` に書けないことは、「起動の要件」の節の hook と起動引数で守る。俯瞰役は `cmux read-screen` で外部の文章を含みうる画面を読むので、俯瞰役の書き込み先を `board/current` に限る。

### merge と Ready 化

merge と Ready 化の承認カードには、対象 PR の番号と head SHA を入れます。管理役は、回答の時点から head SHA が変わっていたら実行せず、質問を出し直します。承認カードの回答は、上の「取り消しにくい操作」の条件（qid を含む Send to Claude のコメント）を満たしたときだけ有効にします。ページでの承認を、CLAUDE.md の「ユーザーの明示的な承認」として扱ってよいかは、ユーザーが決めます。この論点は「決めてほしい点」の1番です。

仕事環境（`profile` が `work`）では、merge と Ready 化に permissions の `ask` が承認プロンプトを出します。ユーザーは、この承認プロンプトにページではなく Remote Control の画面で答えます。

### 秘密値

- db とページには、トークン、パスワード、API キー、顧客データを書かない。
- 俯瞰役は `cmux read-screen` の出力を `board/current` にそのまま写さない。セッション名、状態、PR 番号、1行の要約だけを書く。
- エラーログは db に入れない。ログの場所だけを書く。

### 権限確認で止まったセッション

- 俯瞰役は、`cmux read-screen` で権限確認の画面を見つけたら、`board/current` の該当セッションの状態を `needs-approval` にする。ページはそのセッションを判断待ちの欄の先頭に出す。
- ユーザーは Remote Control の画面（claude.ai/code またはモバイルアプリ）で答える。管理役と俯瞰役は代わりに答えない。
- Remote Control を使わないセッションは、いまと同じくターミナルでの操作が残る。

## 障害からの復帰

- 管理役を再起動したとき: 管理役は操作ページの HTML を同じファイルパスで再公開し、`ArtifactComments` の watch の一覧で「auto-replies armed」を確かめる。続けて `handled == false` と `handled == processing` の行を読む。
- `processing` のまま残った行: 管理役が処理の途中で落ちた可能性がある。管理役は、その行の操作がすでに実行済みかを確かめてから `done` にする。確かめられないときは、質問カードでユーザーに聞く。merge 以外の操作（SendMessage での指示など）にも同じ手順を使う。
- ユーザーがターミナルで管理役に Ctrl+C で割り込んだとき: 自動返信はユーザーの次のメッセージまで止まる。ブラウザからの起床も止まるので、ユーザーは割り込んだ後に管理役へ何か1つメッセージを送る。
- 俯瞰役が止まったとき: ページが `heartbeatAt` の古さで警告する。ユーザーは操作ページの連絡欄で管理役に俯瞰役の再起動を頼む。

## 既存の cmux-orchestration スキルとの関係

| 項目 | 扱い |
|---|---|
| セッションの起動手順、SendMessage での報告とレビュー | 残す |
| 権限確認は管理役が代わりに答えない、という規則 | 残す。答える場所を Remote Control の画面に移す |
| 静的 HTML のダッシュボード雛形（`SKILL.md` の「ダッシュボード」節） | 置き換える。db を読むページを1つ用意し、管理役はコードを変えるときだけ再公開する |
| 「ユーザーの操作が必要なもの」欄 | 置き換える。質問カードと `needs-approval` の表示にする |
| バックログと決定事項を1つの Markdown にまとめる規則 | 残す。俯瞰役が `board/current` に写す |
| セッションと PR の状態を正本にしない規則 | 残す。俯瞰役が確かめる |
| ダッシュボードを作る基準（同時セッション4つ以上など） | 見直す。ブラウザだけを見る運用では、作業が1つでもページを使う |
| 管理役が sleep の待機タイマーで報告を待つ手順（`SKILL.md:32`） | 置き換える。待機中の管理役は SendMessage と Send to Claude で起きるので、sleep のタイマーは要らない。報告が来ないセッションは、俯瞰役が状態の変化として検知する |

ユーザーがこの設計を承認した後に、別の PR でスキル、hook、settings を変更します。

## 試作で確かめたこと

`docs/design/browser-control-plane/prototype.html` を private の Artifact として公開しました。データはすべて「（例）」と書いた例で、ユーザーの実データは入れていません。

- `ArtifactData` の batch で `questions/q-example-1` と `board/current` を書き、ページの `onSnapshot` で読める形になっていることを確かめた。
- `as_level: admin` で `questions` を読むと何も返らず、`owner` 以外が rules で読めないことを確かめた。
- 公開した直後の watch の一覧で、このセッションの watch が「auto-replies armed」になっていることを確かめた。

### 公開時に渡した capabilities

試作の公開では、Artifact ツールの `capabilities` 引数に次の JSON を渡しました。`comments` は完全形の `{}` で宣言しています。

```json
{"db": {"rules": [{"path": "questions", "read": "owner", "write": "owner"}, {"path": "answers", "read": "owner", "write": "owner"}, {"path": "inbox", "read": "owner", "write": "owner"}, {"path": "board", "read": "owner", "write": "owner"}]}, "user": {}, "comments": {}}
```

試作の HTML は、描画時の `canSendToClaude()` の確認、`notified` の記録、「管理役に知らせる」ボタン、`heartbeatAt` の警告を含む版に更新しました。公開中の版は、更新後の版です。

## 未確認事項

1. ページの `sendToClaude` で、cmux で動く管理役に実際にターンが始まるか。試作では回答ボタンを押していない。確かめる手順は、ユーザーが試作ページで例の質問に答え、公開したセッションに返信が来るかを見ることである。クリックの後に db への保存を待ってから `sendToClaude` を呼ぶため、「直近の操作」の条件を満たさず `claude_unavailable` で失敗する可能性がある。失敗したときは「管理役に知らせる」ボタンで送り直せる。
2. 数時間動きがなく watch が終わった後に、同じファイルを再公開すると自動返信が再び有効になるか。ArtifactComments ツールの説明は「publish が自動返信を有効にする」と書いているが、実際には試していない。
3. cmux から起動するすべてのセッションで、Remote Control を自動で有効にできるか。
4. Send to Claude で始まったターンで、`auto` モードの管理役が `ArtifactData` の書き込みと SendMessage を確認なしに実行できるか。
5. サブエージェントから `ArtifactData` を使えるか。watch はメインのセッションだけが持てる（ArtifactComments ツールの説明）ので、管理役はサブエージェントにできない。俯瞰役は `ArtifactData` が使えればサブエージェントにできる。
6. PreToolUse hook で `ArtifactData` の入力（collection）を読み、書き込みを止められるか。

## 決めてほしい点

1. qid を含む Send to Claude のコメントで裏づけたページの承認カード（PR 番号と head SHA つき）を、merge と Ready 化に対する「ユーザーの明示的な承認」として扱ってよいか。扱わない場合、merge と Ready 化はいまと同じくターミナルか Remote Control での承認になる。
2. 俯瞰役を管理役と別のセッションにする案でよいか。
3. バックログの正本を Markdown のままにし、ページは表示だけにする案でよいか。ページでバックログを直接編集したい場合は、正本を db に移す。
4. 権限確認に答える場所として、Remote Control を全セッションで使うか。

## 代替案

ユーザーの要望が「ブラウザで完結」なので、Artifact を第一案にしました。他の手段の利点と欠点は次のとおりです。

| 手段 | 利点 | 欠点 |
|---|---|---|
| Slack | スマートフォンの通知が強い。スレッドで会話の履歴が残る | ブラウザの1画面にまとまらない。他人も書ける場所にメッセージを置くため、本人確認が弱い。投稿には署名行の hook がかかる |
| GitHub Issues / Projects | 履歴が残り、PR と結びつく | エージェントはコメントをポーリングで読むことになり、起こす手段がない。選択肢を選ぶ UI がない。dotfiles 以外のリポジトリにノイズが増える |
| ローカル HTTP サーバー | 画面と動作を自由に作れる。ファイルへの書き込みを `Monitor` で見張れば、LLM を使わずに検知できる | 外出先の端末から開くには外部公開が要り、認証を自作することになる。サーバーの常駐と保守が要る |
| Artifact（採用） | claude.ai のログインで本人確認ができる。db と Send to Claude で、入力の保存とエージェントの起床を1つの仕組みで扱える。スマートフォンでも開ける | ツールは db の行をデータとして扱う。watch は数時間動きがないと切れることがある。Send to Claude の自動返信は1時間60件までである |
