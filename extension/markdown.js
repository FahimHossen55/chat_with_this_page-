// Minimal, self-contained markdown renderer for assistant replies.
// Escapes everything first, then selectively re-introduces a fixed set of
// whitelisted tags via regex passes -- nothing else can ever produce a live
// "<" in the output, so the result is safe to assign via innerHTML even
// though the source text is untrusted LLM output.

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownToHtml(rawText) {
  let text = escapeHtml(rawText);

  // 1. Fenced code blocks -> placeholders (protect contents from later passes).
  // Tokens carry no surrounding whitespace of their own so that later
  // per-line trimming (e.g. in the list pass) can never strip part of
  // the marker and break the re-insertion match below.
  const codeBlocks = [];
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code) => {
    const token = `CODEBLOCK${codeBlocks.length}`;
    codeBlocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return token;
  });

  // 2. Inline code spans -> placeholders (protect contents from bold/italic).
  const codeSpans = [];
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const token = `CODESPAN${codeSpans.length}`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });

  // 3. Bold, then italic.
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/_([^_]+)_/g, "<em>$1</em>");

  // 4. Links -- only allow http(s)/mailto schemes.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    if (/^(https?:|mailto:)/i.test(url)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return match;
  });

  // 5. Lists -- contiguous "- "/"* "/"1. " lines become <ul>/<ol> blocks.
  text = text.replace(/(?:^|\n)((?:[-*] .+(?:\n|$))+)/g, (match, block) => {
    const items = block
      .trim()
      .split("\n")
      .map((line) => `<li>${line.replace(/^[-*] /, "")}</li>`)
      .join("");
    return `\n<ul>${items}</ul>\n`;
  });
  text = text.replace(/(?:^|\n)((?:\d+\. .+(?:\n|$))+)/g, (match, block) => {
    const items = block
      .trim()
      .split("\n")
      .map((line) => `<li>${line.replace(/^\d+\. /, "")}</li>`)
      .join("");
    return `\n<ol>${items}</ol>\n`;
  });

  // 6. Drop newlines touching list tags so they don't double up with
  // those tags' own margins, then turn remaining plain-text newlines
  // into <br>. This runs BEFORE code is re-inserted below, so a code
  // block's own internal newlines are never touched here -- they stay
  // as real newline characters, preserved verbatim by the
  // ".msg pre { white-space: pre }" CSS rule instead.
  text = text.replace(/\n*(<\/?(?:ul|ol)>)\n*/g, "$1");
  text = text.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");

  // 7. Re-insert protected spans/blocks last.
  text = text.replace(/CODESPAN(\d+)/g, (_m, i) => codeSpans[+i]);
  text = text.replace(/CODEBLOCK(\d+)/g, (_m, i) => codeBlocks[+i]);

  return text;
}
