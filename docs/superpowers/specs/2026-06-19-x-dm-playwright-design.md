# X.com DM Playwright スキル 設計書

## 背景

X.com の DM を Claude Code から確認・返信・検索できるようにします。Playwright でブラウザを自動操作し、headed モードで実行します。

## 機能一覧

1. **会話一覧の取得** — 未読優先で DM の会話一覧を取得する
2. **会話履歴の取得** — 特定ユーザーとの会話履歴を取得する
3. **返信** — 既存の会話に返信する
4. **新規DM送信** — 指定ユーザーに新規 DM を送る
5. **DM検索** — DM 内をキーワードで検索する

## 技術構成

- **実装言語**: TypeScript、Bun で実行
- **ブラウザ**: Playwright の Chromium、headed モード
- **認証**: `~/.playwright/x-dm/` に専用の persistent context を保持。初回はユーザーが手動ログインし、以降セッションが永続化される
- **出力形式**: 各スクリプトが JSON を stdout に出力

## ファイル構成

```
dot_claude/skills/x-dm/
├── SKILL.md                      # スキル定義（トリガー条件・呼び出し手順）
├── package.json                  # playwright 依存
└── scripts/
    ├── shared.ts                 # ブラウザ起動・認証チェック・共通ユーティリティ
    ├── list-conversations.ts     # 会話一覧取得
    ├── read-conversation.ts      # 特定会話の履歴取得
    ├── reply.ts                  # 返信送信
    ├── send.ts                   # 新規DM送信
    └── search.ts                 # DM内検索
```

## スクリプト詳細

### shared.ts

ブラウザ起動と認証管理を担う共通モジュールです。

**エクスポートする関数:**

- `launchBrowser(): Promise<{ context: BrowserContext, page: Page }>` — persistent context を `~/.playwright/x-dm/` に作成し、headed モードで起動する。ログイン状態を確認し、未ログインなら `https://x.com/login` へ遷移してユーザーの手動ログインを待機する。URL が `/home` や `/messages` に変わったらログイン完了として処理を続行する
- `closeBrowser(context: BrowserContext): Promise<void>` — context を閉じる
- `navigateToDM(page: Page): Promise<void>` — `https://x.com/messages` へ遷移し、DM 一覧の読み込み完了を待機する

**認証チェックの流れ:**

1. `https://x.com/messages` に遷移
2. ログインページにリダイレクトされたら、stderr に「ブラウザでログインしてください」と出力
3. URL が `/messages` になるまで待機（タイムアウト: 5分）
4. タイムアウトしたら exit code 1 で終了

### list-conversations.ts

**引数**: なし

**処理**: DM一覧ページから会話リストを取得します。未読の会話を優先して返します。

**出力**:
```json
[
  {
    "handle": "@user1",
    "name": "表示名",
    "lastMessage": "最新メッセージのプレビュー...",
    "timestamp": "2h",
    "unread": true
  }
]
```

**取得件数**: 画面に表示されている分（スクロールなし、通常 10〜20 件程度）。

### read-conversation.ts

**引数**: `<handle>` — `@` 付きまたはなしのユーザーハンドル

**処理**: 指定ユーザーとの会話を開き、メッセージ履歴を取得します。画面に表示されている分を取得します（直近のメッセージ群）。

**出力**:
```json
{
  "handle": "@user1",
  "messages": [
    {"sender": "@user1", "text": "こんにちは", "timestamp": "2025-06-19 10:30"},
    {"sender": "@me", "text": "どうも", "timestamp": "2025-06-19 10:32"}
  ]
}
```

### reply.ts

**引数**: `<handle> <message>`

**処理**: 指定ユーザーとの会話を開き、メッセージを入力して送信します。

**出力**:
```json
{"success": true, "handle": "@user1", "message": "送信したテキスト"}
```

**エラー時**: `{"success": false, "error": "エラー内容"}`

### send.ts

**引数**: `<handle> <message>`

**処理**: 新規メッセージ作成画面を開き、宛先を検索・選択してメッセージを送信します。既に会話が存在する場合でも動作します（既存会話に追加される）。

**出力**: reply.ts と同じ形式。

### search.ts

**引数**: `<query>`

**処理**: DM の検索機能を使い、キーワードに一致する会話・メッセージを取得します。

**出力**:
```json
[
  {
    "handle": "@user1",
    "name": "表示名",
    "matchedMessage": "検索にヒットしたメッセージ...",
    "timestamp": "2025-06-19 10:30"
  }
]
```

## SKILL.md トリガー条件

以下のようなユーザー発話でスキルをトリガーします。

- 「DMを確認して」「DM見て」「Twitterのメッセージ確認」→ `list-conversations.ts` → 未読があれば `read-conversation.ts`
- 「XXXにDM送って」「XXXにメッセージ送って」→ `send.ts`
- 「DMで返信して」「XXXに返信して」→ `reply.ts`
- 「DMで○○を検索」「DMから○○を探して」→ `search.ts`

## エラーハンドリング

- **認証切れ**: stderr にメッセージを出し、headed ブラウザでユーザーの再ログインを待機する
- **要素未発見**: X.com の UI 変更でセレクタが壊れた場合、エラーメッセージに該当セレクタ情報を含めて exit code 1 で終了する。Claude がエラー内容をユーザーに伝える
- **タイムアウト**: 各操作に 30 秒のタイムアウトを設定する（認証待ちのみ 5 分）
- **ブラウザ未起動**: Playwright のインストールが必要な場合、`bunx playwright install chromium` の実行を促す

## セレクタ戦略

X.com の DOM は頻繁に変更されます。セレクタの選定方針は以下のとおりです。

1. `data-testid` 属性を優先する。X.com は一部の要素にこの属性を付与している
2. `aria-label` による ARIA セレクタを次善とする
3. クラス名は CSS Modules のハッシュを含むため使用しない
4. テキストコンテンツによるセレクタ（`text=`）は言語依存のため最終手段とする

セレクタが壊れた場合に修正しやすいよう、`shared.ts` にセレクタ定数をまとめて定義します。

## 制約事項

- X.com の利用規約上、過度な自動操作はアカウント制限のリスクがあります。短時間での大量操作は避けてください
- headed モード前提のため、ディスプレイのないサーバー環境では動作しません
- Chrome が起動中でも、専用の persistent context を使うため干渉しません
