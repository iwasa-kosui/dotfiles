#!/bin/bash
# PreToolUse hook: WebFetchのURLを検証し、内部ネットワークへのアクセスをブロック

set -euo pipefail

input=$(cat)
url=$(echo "$input" | jq -r '.tool_input.url // ""')

if [ -z "$url" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# ホスト名を抽出
host=$(echo "$url" | sed -E 's|^https?://([^/:]+).*|\1|')

# 内部ネットワーク・ローカルホストへのアクセスをブロック
case "$host" in
  localhost|127.0.0.1|0.0.0.0|::1)
    echo "{\"decision\": \"block\", \"reason\": \"ローカルホストへのアクセスはブロックされています: ${host}\"}"
    exit 0
    ;;
  10.*.*.* |172.1[6-9].*.* |172.2[0-9].*.* |172.3[0-1].*.* |192.168.*.*)
    echo "{\"decision\": \"block\", \"reason\": \"プライベートネットワークへのアクセスはブロックされています: ${host}\"}"
    exit 0
    ;;
  *.internal|*.local|*.corp)
    echo "{\"decision\": \"block\", \"reason\": \"内部ドメインへのアクセスはブロックされています: ${host}\"}"
    exit 0
    ;;
esac

echo '{"decision": "allow"}'
