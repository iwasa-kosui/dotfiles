# minuet FIM 補完の精度チューニング 設計

## 背景

minuet の常時表示補完は `openai_fim_compatible` プロバイダで `qwen2.5-coder:3b-base` を使い、virtualtext で表示しています。医療系SaaSのプラットフォーム開発で使ううえで、補完の正確さと関連性をもう少し上げたいという要望があります。

現状の設定には精度面で2つの弱点があります。

- `context_window = 2048`（文字数）が小さく、モデルが見る周辺コードは 500〜700 トークン程度にとどまります。関連性低下の主因と考えられます。
- `temperature` を指定しておらず `top_p = 0.9` のみです。コード補完は決定性が高い方が的外れが減りますが、温度が制御されていません。

## スコープ

今回は FIM プロバイダのパラメータ調整に限定します。

非スコープ:

- duet（手動発火の chat 窓口）への kamae 的 system プロンプト注入は別タスクにします。
- モデルサイズの変更（7b 等への移行）は行いません。M1 / 16GB では常時補完のレイテンシ悪化リスクがあるためです。
- VectorCode 等によるリポジトリコンテキスト追加は対象外です。

## 決定事項

### モデルは 3b-base 据え置き

`qwen2.5-coder:3b-base` を維持します。3b は Qwen-Research ライセンスで商用利用不可ですが、ライセンスの扱いはユーザー判断とします。M1 / 16GB では 3b の軽さが常時補完の応答性に効くため、サイズは変えません。

### temperature を 0.2 に固定

minuet の `provider_options.openai_fim_compatible.optional` に `temperature = 0.2` を追加します。ollama の OpenAI 互換 `/v1/completions` は `temperature` と `top_p` を受け付けることを公式ドキュメントで確認済みです。`top_p = 0.9` は維持します。

### context_window を 8192 に拡大

`context_window` を 2048 から 8192（文字数）に拡大します。カーソル前後の周辺コードをより多く渡し、補完の関連性を高めます。

### num_ctx 8192 を固定したカスタムモデルを作る

ollama の OpenAI 互換エンドポイントは `num_ctx` を受け付けません。GitHub Issue #5356 / #7063 で要望が続いていますが 2026 年時点で未実装です。`context_window` を 8192 文字に増やしても、モデル側のコンテキスト長が足りなければ切り詰められます。

確実に効かせるため、Modelfile で `PARAMETER num_ctx 8192` を固定したカスタムモデルを `ollama create` し、minuet の `model` をそれに差し替えます。

カスタムモデル名は `qwen2.5-coder-3b-fim` とします。

```
FROM qwen2.5-coder:3b-base
PARAMETER num_ctx 8192
```

temperature は Modelfile ではなく minuet 側の `optional` で制御します。設定が minuet.lua 上で見えるようにし、Modelfile はコンテキスト長の確保だけに責務を絞ります。

### 据え置くパラメータ

- `max_tokens = 128`: 1〜数行の補完には十分です。長くすると遅くなり的外れも増えるため変えません。
- `throttle = 1500` / `debounce = 600`: context_window 拡大で 1 リクエストが重くなるため、発火頻度は上げず応答性を優先します。
- FIM テンプレート: 現状 template 未指定で動作しているため触りません。ollama 経由の特殊トークン二重付与は、現状壊れていないことから問題ないと判断します。

## 構成変更

1. **Modelfile の用意とカスタムモデル作成**: `qwen2.5-coder-3b-fim` を `ollama create` する処理を追加します。
2. **keep-alive スクリプトの更新**: 既存の `run_onchange_after_ollama-keep-alive.sh.tmpl` が pin しているモデル名を `qwen2.5-coder-3b-fim` に変更します。pin 対象を、minuet が実際に使うカスタムモデルに合わせます。
3. **minuet.lua の opts 変更**:
   - `context_window` を 8192 に。
   - `provider_options.openai_fim_compatible.model` を `qwen2.5-coder-3b-fim` に。
   - `optional` に `temperature = 0.2` を追加。

## 論点（実装前に決める）

- **Modelfile と ollama create の配置**: 既存 keep-alive スクリプトに `ollama create` を同居させるか、専用の run_onchange スクリプトに分けるか。両方とも ollama のセットアップなので同居でも筋は通りますが、責務を分けるなら別スクリプトにします。Modelfile 本体は別ファイルとして chezmoi 管理下に置くか、スクリプト内で heredoc 生成するかも合わせて決めます。
- **既存カスタムモデルの再作成タイミング**: ベースモデルを再 pull したときにカスタムモデルを作り直す必要があるか。`run_onchange` のハッシュトリガーで Modelfile 変更時のみ再作成される挙動でよいか。

## 検証

- `ollama show qwen2.5-coder-3b-fim` で num_ctx が 8192 になっていることを確認します。
- Neovim で実際に補完を出し、関連性が上がっているか、レイテンシが体感で許容範囲かを確認します。
- 重ければ context_window と num_ctx を 4096 に下げる前提で進めます。
