// 出力文の語彙を機械的に検査する。
//
// 置換候補を持たない禁止語が対象なので、修正は提案しない。prh は誤記を正記に直す仕組みで、
// expected が置換文字列として使われるため、この用途では --fix が本文を壊す。
//
// コードスパンとコードブロックは Str ノードにならないため、自動的に対象外になる。
// ルール本文が禁止語を引用するときはコードスパンで囲む。

/** hook で有効にする検査。誤検知がほぼ起きない語彙だけを置く。 */
const CHECKS = [
  {
    message: "比喩や暗喩を使わず、何を指しているかを直接書いてください",
    pattern: /設計の天井|成功の鍵|銀の弾丸|羅針盤|ボトルネックの根/g,
  },
  {
    // 造語と、日本語圏で定着していない専門用語をまとめて見る。判断の基準は正しさではなく、
    // 読み手が脳内変換せずに読めるかどうか。「上界」は数学では正式な語だが通じない。
    message: "定着していない語は使わず、読み手に通じる語に置き換えてください",
    pattern: /空句|表化|上界/g,
  },
  {
    message: "直訳ではなく、業界で定着した日本語訳を使ってください",
    pattern: /硬化させ|として乗る|に倒れる/g,
  },
  {
    message: "ビジネス文書調です。平易な語に置き換えてください",
    pattern: /織り込|達成目標|保証目標値/g,
  },
  {
    message: "空虚な形容です。何がどうなのかを具体的に書いてください",
    pattern: /不可欠|核心的|多角的|包括的/g,
  },
  {
    message: "空虚な動詞です。何をするのかを具体的に書いてください",
    pattern: /掘り下げ/g,
  },
  {
    message: "中身のない強調です。程度を示す必要があれば具体的な数値を書いてください",
    pattern: /大いに/g,
  },
  {
    message: "予告や総括は書かず、本文から直接始めてください",
    pattern: /重要なのは|本書では|まとめると|に他ならない/g,
  },
  {
    message: "過剰な丁寧表現です。必要最小限のです・ます調にしてください",
    pattern: /ご検討いただければ|よろしくお願いいた|幸いです/g,
  },
  {
    message: "西暦を添えて絶対日付にしてください",
    pattern:
      /来月|先月|今月|翌月|前月|来週|先週|今週|今期|今四半期|来四半期|昨年|来年|今年度|来年度|先スプリント|今スプリント|来スプリント/g,
  },
  {
    // 「2026年10月」のように西暦が前置されている場合は対象外にする。
    message: "西暦を添えて絶対日付にしてください",
    pattern: /(?<![0-9年]\s?)[0-9]{1,2}\s?月(末|初|上旬|中旬|下旬)?/g,
  },
];

/**
 * hook では有効にしない検査。機械的に正誤を分けられず、送信を止めると損失のほうが大きい。
 */
const ADVISORY_CHECKS = [
  {
    // 訳語の併記も、英語から始まる説明の挿入句も対象にする。挿入句は文の節に展開する。
    // 固有名詞・製品名・コード識別子の併記は許容するため、機械判定にはできない。
    message: "英語の括弧書きをやめ、文の節に展開するか別文にしてください",
    pattern: /（[A-Za-z][^）]*）/g,
  },
  {
    // Str ノードは箇条書きの項目も含む。箇条書きの言い切りは許容するので誤検知になる。
    message: "地の文はです・ます調にしてください",
    pattern: /(である|であった|だった|ではない|だ)。/g,
  },
  {
    // UTF-8 や SHA-256 のような規格名と Jira のプロジェクトキーを regexp では分けられない。
    // 既に Markdown リンクや URL になっている ID も拾う。
    message: "Jira 課題は URL でリンクしてください",
    pattern: /(^|[^/])\b[A-Z]{2,10}-[0-9]+\b/g,
  },
];

/** 指定位置が属する行を返す。 */
function lineAt(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

const rule = (context, options = {}) => {
  const { Syntax, RuleError, report, getSource } = context;
  const checks = options.includeAdvisory ? [...CHECKS, ...ADVISORY_CHECKS] : CHECKS;

  return {
    [Syntax.Str](node) {
      const text = getSource(node);
      for (const { message, pattern } of checks) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const [found] = match;
          // ❌ や ✅ を付けた行は、禁止事項を示す例示なので対象外にする。
          // textlint-filter-rule-allowlist は独自ルールの指摘を抑制しないため、ここで判定する。
          if (/[❌✅]/.test(lineAt(text, match.index))) continue;
          report(node, new RuleError(`${found} は使いません。${message}`, { index: match.index }));
        }
      }
    },
  };
};

module.exports = rule;
module.exports.CHECKS = CHECKS;
module.exports.ADVISORY_CHECKS = ADVISORY_CHECKS;
