---
name: x-dm
description: X.com（Twitter）のDMをPlaywrightで操作するスキル。会話一覧の確認、会話履歴の閲覧、返信、新規DM送信、DM検索を行う。「DMを確認して」「DM見て」「XXXにDM送って」「DMで返信して」「DMで○○を検索」「Twitterのメッセージ確認」などと言われたら積極的に使用する。X.comやTwitterのダイレクトメッセージに関する操作全般でトリガーする。
---

# X.com DM

X.com の DM を Playwright で操作するスキルです。headed モードのブラウザを起動し、会話の確認・返信・送信・検索を行います。

## いつ使うか

- 「DMを確認して」「DM見て」「Twitterのメッセージ確認して」→ 会話一覧と未読の確認
- 「XXXにDM送って」「XXXにメッセージ送って」→ 新規DM送信
- 「DMで返信して」「XXXに返信して」→ 既存会話への返信
- 「DMで○○を検索」「DMから○○を探して」→ DM内検索
- X.com / Twitter のダイレクトメッセージに関する操作全般

## 前提条件

スクリプト実行前に、依存パッケージのインストールが必要です。

```bash
cd <skill-dir> && bun install
```

Playwright の Chromium がインストールされていない場合:

```bash
bunx playwright install chromium
```

## 認証

`~/.playwright/x-dm/` に専用のブラウザプロファイルを保持します。初回実行時はブラウザが開き、X.com のログイン画面が表示されます。ユーザーが手動でログインすると、セッションが保存されて以降の実行では自動的にログイン済み状態で起動します。

実行にはシステムにインストールされた Chrome が必要です。`channel: "chrome"` オプションにより、Playwright バンドルの Chromium ではなく本物の Chrome を使用します。

## スクリプト

すべてのスクリプトは `<skill-dir>/scripts/` に配置されています。`bun` で実行し、結果は JSON で stdout に出力されます。

### 1. 会話一覧の取得

```bash
bun <skill-dir>/scripts/list-conversations.ts
```

引数なし。DM の会話一覧を取得します。

出力例:
```json
[
  {"id": "982633121542623235-1282929510673813504", "name": "かわうそ", "lastMessage": "kosuiさん ご無沙汰しています！...", "timestamp": "3日"}
]
```

### 2. 会話履歴の取得

```bash
bun <skill-dir>/scripts/read-conversation.ts <name>
```

指定ユーザー名を含む会話の履歴を取得します。会話一覧のテキストと部分一致で検索します。

出力例:
```json
{
  "handle": "@ユーザー名",
  "messages": [
    {"sender": "@ユーザー名", "text": "こんにちは", "timestamp": ""}
  ]
}
```

### 3. 返信

```bash
bun <skill-dir>/scripts/reply.ts <name> <message>
```

指定ユーザーとの既存会話にメッセージを送信します。

出力例:
```json
{"success": true, "handle": "@ユーザー名", "message": "送信したテキスト"}
```

**重要**: 返信を送る前に、必ずユーザーに送信内容を確認してください。確認なしで送信しないこと。

### 4. 新規DM送信

```bash
bun <skill-dir>/scripts/send.ts <handle> <message>
```

指定ユーザーに新規DMを送信します。

**重要**: 送信前に、必ずユーザーに宛先と内容を確認してください。確認なしで送信しないこと。

### 5. DM検索

```bash
bun <skill-dir>/scripts/search.ts <query>
```

DM内をキーワードで検索します。

## ワークフロー例

### 「DMを確認して」と言われた場合

1. `list-conversations.ts` で会話一覧を取得
2. 結果をユーザーに一覧表示
3. ユーザーが特定の会話を深掘りしたい場合は `read-conversation.ts` で履歴を取得

### 「XXXに返信して」と言われた場合

1. 送信メッセージの内容を確認
2. 宛先と内容を表示して最終確認を取る
3. `reply.ts` で送信
4. 結果をユーザーに報告

## エラー時の対応

- **認証切れ**: ブラウザが表示されるので、ユーザーに手動ログインを依頼する
- **セレクタ不一致**: X.com の UI が変更された可能性があります。`shared.ts` の `SELECTORS` を更新してください
- **Chrome 未インストール**: システムに Google Chrome が必要です

## 制約事項

- X.com の利用規約上、過度な自動操作はアカウント制限のリスクがあります。短時間での大量操作は避けてください
- headed モード前提のため、ブラウザウィンドウが表示されます
- DM の送信・返信は取り消せない操作です。必ずユーザーの最終確認を取ってから実行してください
