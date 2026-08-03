#!/usr/bin/env python3
"""caveman_lint.py

Verify that a response follows the `caveman` skill rules: no articles,
filler words, pleasantries, or hedging outside of code spans.

Code blocks (``` ... ```) and inline code (`...`) are ignored by the lint,
since their contents are technical and must stay unchanged.

Exit code: 0 if no violations found, 1 otherwise.

Usage:
    python caveman_lint.py "response text"
    python caveman_lint.py --file some.md
"""

import argparse
import re
import sys

ARTICLES = ["a", "an", "the"]
FILLER = ["just", "really", "basically", "actually", "simply"]
HEDGING = ["might", "maybe", "perhaps", "likely"]
PLEASANTRIES = ["sure", "certainly", "of course", "happy to", "sure thing"]

RULES = {
    "article": ARTICLES,
    "filler": FILLER,
    "hedging": HEDGING,
    "pleasantry": PLEASANTRIES,
}

_CODE_SPLIT_RE = re.compile(r"(```.*?```|`[^`\n]*`)", re.DOTALL)


def _non_code_segments(text: str):
    """Yield (segment_text, start_offset_in_original_text) for every
    segment of `text` that is NOT inside a fenced/inline code span."""
    offset = 0
    for segment in _CODE_SPLIT_RE.split(text):
        if not segment.startswith("`"):
            yield segment, offset
        offset += len(segment)


def find_violations(text: str):
    """Return a list of violation dicts: category, word, position, line,
    context (a short snippet around the match)."""
    violations = []
    for category, words in RULES.items():
        for word in words:
            pattern = re.compile(r"(?i)\b" + re.escape(word) + r"\b")
            for segment, offset in _non_code_segments(text):
                for match in pattern.finditer(segment):
                    pos = offset + match.start()
                    line = text.count("\n", 0, pos) + 1
                    start = max(0, match.start() - 20)
                    end = min(len(segment), match.end() + 20)
                    context = segment[start:end].strip().replace("\n", " ")
                    violations.append(
                        {
                            "category": category,
                            "word": match.group(0),
                            "position": pos,
                            "line": line,
                            "context": context,
                        }
                    )
    violations.sort(key=lambda v: v["position"])
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", nargs="?", help="Response text to lint")
    parser.add_argument("--file", help="Read response text to lint from a file")
    args = parser.parse_args()

    if args.file:
        with open(args.file, "r", encoding="utf-8") as fh:
            text = fh.read()
    elif args.text is not None:
        text = args.text
    else:
        text = sys.stdin.read()

    violations = find_violations(text)

    if not violations:
        print("OK: no caveman-rule violations found.")
        return 0

    print(f"FAIL: {len(violations)} caveman-rule violation(s) found:\n")
    for v in violations:
        print(
            f"  line {v['line']} [{v['category']}] '{v['word']}' "
            f"-> ...{v['context']}..."
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
