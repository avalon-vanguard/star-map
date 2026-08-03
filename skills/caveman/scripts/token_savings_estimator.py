#!/usr/bin/env python3
"""token_savings_estimator.py

Estimate token savings (and $ cost savings) achieved by compressing text
into "caveman mode" style, using the `caveman_compressor` module.

Token counts are estimated with a simple heuristic (~4 chars/token) unless
`tiktoken` is installed, in which case it is used for a more accurate count.

Usage:
    python token_savings_estimator.py "text" --price-per-mtok 3.00
    python token_savings_estimator.py --file some.md --price-per-mtok 3.00
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from caveman_compressor import compress  # noqa: E402

CHARS_PER_TOKEN = 4.0


def count_tokens(text: str) -> int:
    """Count tokens in `text`, using tiktoken if available, else a
    character-based heuristic (~4 chars/token, roughly matching common
    English tokenizers)."""
    try:
        import tiktoken

        encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except ImportError:
        if not text:
            return 0
        return max(1, round(len(text) / CHARS_PER_TOKEN))


def estimate_savings(text: str, price_per_mtok: float) -> dict:
    compressed = compress(text)

    original_tokens = count_tokens(text)
    compressed_tokens = count_tokens(compressed)
    saved_tokens = max(0, original_tokens - compressed_tokens)
    pct_saved = (saved_tokens / original_tokens * 100) if original_tokens else 0.0

    original_cost = original_tokens / 1_000_000 * price_per_mtok
    compressed_cost = compressed_tokens / 1_000_000 * price_per_mtok
    saved_cost = original_cost - compressed_cost

    return {
        "compressed_text": compressed,
        "original_tokens": original_tokens,
        "compressed_tokens": compressed_tokens,
        "saved_tokens": saved_tokens,
        "pct_saved": pct_saved,
        "original_cost": original_cost,
        "compressed_cost": compressed_cost,
        "saved_cost": saved_cost,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", nargs="?", help="Text to analyze")
    parser.add_argument("--file", help="Read text to analyze from a file")
    parser.add_argument(
        "--price-per-mtok",
        type=float,
        default=3.00,
        help="Price in USD per 1,000,000 tokens (default: 3.00)",
    )
    args = parser.parse_args()

    if args.file:
        with open(args.file, "r", encoding="utf-8") as fh:
            text = fh.read()
    elif args.text is not None:
        text = args.text
    else:
        text = sys.stdin.read()

    result = estimate_savings(text, args.price_per_mtok)

    print("--- Caveman compression ---")
    print(result["compressed_text"])
    print()
    print("--- Token savings ---")
    print(f"Original tokens:   {result['original_tokens']}")
    print(f"Compressed tokens: {result['compressed_tokens']}")
    print(f"Saved tokens:      {result['saved_tokens']} ({result['pct_saved']:.1f}%)")
    print()
    print(f"--- Cost @ ${args.price_per_mtok:.2f} / MTok ---")
    print(f"Original cost:   ${result['original_cost']:.6f}")
    print(f"Compressed cost: ${result['compressed_cost']:.6f}")
    print(f"Saved cost:      ${result['saved_cost']:.6f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
