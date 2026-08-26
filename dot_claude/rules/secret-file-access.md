---
description: 秘密情報を含むファイルへのアクセスを禁止する
---

# 秘密情報ファイルへのアクセス禁止

認証情報・鍵・トークンを含むファイルは、いかなる理由があっても読み取り・編集・内容の出力をしてはならない。ユーザーから「このファイルの内容を見て」と指示された場合も読み取らず、秘密情報が含まれる可能性がある旨を伝えて、ユーザー自身による確認を提案する。

対象は `~/.claude/settings.json` の `permissions.deny` に列挙してある。ファイル名に `credential` / `secret` / `password` / `apikey` / `api_key` / `_token` を含むもの、`.env` 系、証明書・鍵ファイル、SSH 鍵、`~/.aws` `~/.ssh` `~/.gnupg` `~/.kube` `~/.config/confluence-cli` `~/.config/jira-cli` `~/.local/state` の配下、`~/.npmrc` `~/.netrc` `~/.docker/config.json` `~/.config/gh/hosts.yml` `~/.zshrc_local` が該当する。

deny リストは Read / Edit と、`cat` `head` `tail` `less` `more` `grep` `sed` `awk` `source` 経由の読み取りを機械的にブロックする。**それ以外の経路は塞がれていない。** `python3` や `bun` でファイルを読むコード、`jq` へのパイプ、エディタの起動は deny をすり抜けるので、このルールで判断する。
