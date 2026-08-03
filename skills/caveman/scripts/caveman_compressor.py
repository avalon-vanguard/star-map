#!/usr/bin/env python3
"""caveman_compressor.py

Compress text into "caveman mode" style per the `caveman` skill rules:
drop articles, filler, pleasantries, and hedging; abbreviate common
technical terms; turn simple causal phrases into `X -> Y` arrows.

Code blocks (``` ... ```) and inline code (`...`) are left untouched.

Usage:
    python caveman_compressor.py "text to compress"
    python caveman_compressor.py --file some.md
"""

import argparse
import re
import sys

# Words/phrases dropped entirely (case-insensitive, whole-word match).
ARTICLES = ["a", "an", "the"]
FILLER = ["just", "really", "basically", "actually", "simply"]
HEDGING = ["might", "maybe", "perhaps", "likely"]

# Multi-word pleasantries dropped entirely (checked as phrases, longest first).
PLEASANTRIES = [
    "of course",
    "happy to",
    "sure thing",
    "certainly",
    "sure",
]

DROP_WORDS = ARTICLES + FILLER + HEDGING

# Common abbreviations. Keys are matched case-insensitively as whole words;
# the replacement preserves the target casing shown here.
ABBREVIATIONS = {
    "database": "DB",
    "databases": "DBs",
    "authentication": "auth",
    "configuration": "config",
    "configurations": "configs",
    "request": "req",
    "requests": "reqs",
    "response": "res",
    "responses": "res",
    "function": "fn",
    "functions": "fns",
    "implementation": "impl",
    "implementations": "impls",
    "environment": "env",
    "environments": "envs",
    "dependency": "dep",
    "dependencies": "deps",
    "repository": "repo",
    "repositories": "repos",
    "documentation": "docs",
    "application": "app",
    "applications": "apps",
}

# Causal phrases turned into `X -> Y` arrows.
CAUSAL_PHRASES = [
    "leads to",
    "results in",
    "causes",
    "will cause",
]

# Splits text into segments, tagging fenced code blocks / inline code so
# they can be skipped during compression.
_CODE_SPLIT_RE = re.compile(r"(```.*?```|`[^`\n]*`)", re.DOTALL)


def _drop_words(text: str) -> str:
    for phrase in PLEASANTRIES:
        text = re.sub(
            r"(?i)\b" + re.escape(phrase) + r"\b[,!]?\s*", "", text
        )
    for word in DROP_WORDS:
        text = re.sub(r"(?i)\b" + re.escape(word) + r"\b\s*", "", text)
    return text


def _abbreviate(text: str) -> str:
    for long_form, short_form in ABBREVIATIONS.items():
        text = re.sub(
            r"(?i)\b" + re.escape(long_form) + r"\b",
            short_form,
            text,
        )
    return text


def _arrows(text: str) -> str:
    for phrase in CAUSAL_PHRASES:
        text = re.sub(r"(?i)\s*\b" + re.escape(phrase) + r"\b\s*", " -> ", text)
    return text


def _cleanup_whitespace(text: str) -> str:
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"[ \t]+([,.!?;:])", r"\1", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"^[ \t]+", "", text, flags=re.MULTILINE)
    return text.strip()


def compress(text: str) -> str:
    """Compress `text` into caveman style, preserving code spans."""
    segments = _CODE_SPLIT_RE.split(text)
    out = []
    for segment in segments:
        if segment.startswith("`"):
            out.append(segment)
            continue
        compressed = segment
        compressed = _arrows(compressed)
        compressed = _drop_words(compressed)
        compressed = _abbreviate(compressed)
        compressed = _cleanup_whitespace(compressed)
        out.append(compressed)
    return "".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", nargs="?", help="Text to compress")
    parser.add_argument("--file", help="Read text to compress from a file")
    args = parser.parse_args()

    if args.file:
        with open(args.file, "r", encoding="utf-8") as fh:
            text = fh.read()
    elif args.text is not None:
        text = args.text
    else:
        text = sys.stdin.read()

    print(compress(text))
    return 0


if __name__ == "__main__":
    sys.exit(main())
