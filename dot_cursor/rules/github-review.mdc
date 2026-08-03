---
description: GitHub PRレビューコメントの書式ルール
alwaysApply: false
---

# GitHub レビュー

レビューコメント・PRコメントを送信する時は、本文全体を details ブロックで囲む。

````markdown
<details>
<summary>🤖 Claude Code</summary>

本文

</details>
````

`<summary>` 行の後と `</details>` の前には空行を入れる。空行がないとGitHubが中身をMarkdownとして解釈せず、リストや見出しが素のテキストとして表示される。

`gh-comment-format-guard.ts` hook がこの書式を強制するため、囲まずに送信しようとするとブロックされる。
