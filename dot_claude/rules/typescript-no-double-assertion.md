---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript: `as unknown as` を絶対に使わない

## ルール

TypeScriptコードで `as unknown as T` というダブルアサーションを書いてはならない。例外なし。あらゆる理由を問わず禁止。

## 理由

`as unknown as T` は型システムを完全にバイパスし、コンパイラの安全性チェックを無効化する。これは型エラーを「修正」しているのではなく「隠蔽」しているだけで、本来コンパイル時に検出されるべきバグを実行時まで先送りする。型不一致は設計の問題のシグナルであり、アサーションで黙らせるべきではない。

## 代替手段

- **型定義の修正**: アサーションが必要に見える場合、まず型定義そのものを直す
- **ランタイムバリデーション**: 外部入力など真に型が不明なデータは zod / valibot 等で検証してから型を確定させる
- **型ガード**: `function isFoo(x: unknown): x is Foo` でナローイングする
- **ジェネリクスの活用**: 関数や型のパラメータ化で型関係を表現する
- **discriminated union**: 状態に応じた型分岐は判別共用体で表現する

## 悪い例

```typescript
// ❌ 型システムを欺いている
const user = response.data as unknown as User;

// ❌ テストでも禁止
const mock = {} as unknown as Database;
```

## 良い例

```typescript
// ✅ ランタイムバリデーション
const user = userSchema.parse(response.data);

// ✅ 型ガード
if (isUser(response.data)) {
  const user = response.data;
}

// ✅ テストではモックライブラリかPartialの明示的な構築
const mock: Database = createMockDatabase();
```

## 例外

なし。`as unknown as` を書きたくなったら、それは型設計を見直すべきサイン。
