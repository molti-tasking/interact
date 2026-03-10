/**
 * Simple word-level diff display between previous and current prompt.
 * Shows removed words in red and added words in green.
 */
export const PromptDiff = ({
  previous,
  current,
}: {
  previous: string;
  current: string;
}) => {
  const diff = computeWordDiff(previous, current);

  return (
    <div className="whitespace-pre-wrap">
      {diff.map((segment, i) => {
        if (segment.type === "removed") {
          return (
            <span
              key={i}
              className="bg-red-200 text-red-800 line-through dark:bg-red-900/40 dark:text-red-300"
            >
              {segment.text}
            </span>
          );
        }
        if (segment.type === "added") {
          return (
            <span
              key={i}
              className="bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-300"
            >
              {segment.text}
            </span>
          );
        }
        return <span key={i}>{segment.text}</span>;
      })}
    </div>
  );
};

type DiffSegment = {
  type: "same" | "added" | "removed";
  text: string;
};

/**
 * Simple word-level diff using longest common subsequence.
 */
function computeWordDiff(oldText: string, newText: string): DiffSegment[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);

  // LCS table
  const m = oldWords.length;
  const n = newWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const segments: DiffSegment[] = [];
  let i = m;
  let j = n;

  const raw: { type: DiffSegment["type"]; text: string }[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      raw.push({ type: "same", text: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: "added", text: newWords[j - 1] });
      j--;
    } else {
      raw.push({ type: "removed", text: oldWords[i - 1] });
      i--;
    }
  }

  raw.reverse();

  // Merge consecutive segments of the same type
  for (const entry of raw) {
    const last = segments[segments.length - 1];
    if (last && last.type === entry.type) {
      last.text += entry.text;
    } else {
      segments.push({ ...entry });
    }
  }

  return segments;
}
