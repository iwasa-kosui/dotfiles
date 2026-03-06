#!/usr/bin/env python3
"""Run rule effectiveness tests: with-rule vs without-rule comparison.

For each eval prompt in evals.json, runs `claude -p` twice:
  1. With the rule file present in .claude/rules/
  2. Without the rule file

Outputs are saved to a workspace directory compatible with
skill-creator's eval-viewer/generate_review.py.

Usage:
    python rule_tester.py <rule-file> <evals-json> [--workspace DIR] [--workers N]

Example:
    python rule_tester.py dot_claude/rules/conventional-commits.md evals/evals.json
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path


def find_project_root() -> Path:
    """Find the project root by walking up from cwd looking for .claude/."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".claude").is_dir():
            return parent
    return current


def run_single(
    prompt: str,
    eval_id: int,
    config: str,
    rule_source: Path | None,
    project_root: Path,
    output_dir: Path,
    timeout: int,
    model: str | None = None,
) -> dict:
    """Run claude -p with or without a rule and capture outputs.

    Args:
        prompt: The eval prompt to send.
        eval_id: Eval identifier.
        config: "with_rule" or "without_rule".
        rule_source: Path to the rule file (None for without_rule).
        project_root: Project root directory.
        output_dir: Where to save outputs.
        timeout: Timeout in seconds.
        model: Optional model override.

    Returns:
        Dict with run metadata and timing.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Set up temporary rule file if needed
    rules_dir = project_root / ".claude" / "rules"
    temp_rule: Path | None = None

    if rule_source and config == "with_rule":
        rules_dir.mkdir(parents=True, exist_ok=True)
        # Use a unique name to avoid conflicts
        unique_id = uuid.uuid4().hex[:8]
        temp_rule = rules_dir / f"_test_{unique_id}_{rule_source.name}"
        shutil.copy2(rule_source, temp_rule)

    try:
        cmd = [
            "claude",
            "-p", prompt,
            "--output-format", "json",
            "--verbose",
        ]
        if model:
            cmd.extend(["--model", model])

        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        start_time = time.time()
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(project_root),
            env=env,
            timeout=timeout,
        )
        duration = time.time() - start_time

        # Parse response
        response_text = ""
        total_tokens = 0
        try:
            response = json.loads(result.stdout)
            response_text = response.get("result", result.stdout)
            # Try to extract token usage
            usage = response.get("usage", {})
            total_tokens = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        except (json.JSONDecodeError, TypeError):
            response_text = result.stdout

        # Save outputs
        (output_dir / "response.md").write_text(response_text)

        # Save transcript
        transcript = f"## Eval Prompt\n\n{prompt}\n\n## Response\n\n{response_text}"
        (output_dir / "transcript.md").write_text(transcript)

        # Save timing
        timing = {
            "total_tokens": total_tokens,
            "duration_ms": int(duration * 1000),
            "total_duration_seconds": round(duration, 1),
        }
        (output_dir.parent / "timing.json").write_text(json.dumps(timing, indent=2))

        return {
            "eval_id": eval_id,
            "config": config,
            "success": result.returncode == 0,
            "duration": duration,
            "total_tokens": total_tokens,
        }

    except subprocess.TimeoutExpired:
        (output_dir / "response.md").write_text("(Timed out)")
        return {
            "eval_id": eval_id,
            "config": config,
            "success": False,
            "duration": timeout,
            "total_tokens": 0,
        }
    finally:
        # Clean up temporary rule file
        if temp_rule and temp_rule.exists():
            temp_rule.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test rule effectiveness: with-rule vs without-rule"
    )
    parser.add_argument("rule_file", type=Path, help="Path to the rule .md file")
    parser.add_argument("evals_json", type=Path, help="Path to evals.json")
    parser.add_argument(
        "--workspace", "-w", type=Path, default=None,
        help="Workspace directory (default: <rule-name>-workspace/iteration-1)",
    )
    parser.add_argument("--workers", type=int, default=4, help="Parallel workers")
    parser.add_argument("--timeout", type=int, default=120, help="Timeout per run (seconds)")
    parser.add_argument("--model", default=None, help="Model override")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    if not args.rule_file.exists():
        print(f"Error: Rule file not found: {args.rule_file}", file=sys.stderr)
        sys.exit(1)

    if not args.evals_json.exists():
        print(f"Error: Evals file not found: {args.evals_json}", file=sys.stderr)
        sys.exit(1)

    evals_data = json.loads(args.evals_json.read_text())
    evals = evals_data.get("evals", [])
    skill_name = evals_data.get("skill_name", args.rule_file.stem)

    if not evals:
        print("Error: No evals found in evals.json", file=sys.stderr)
        sys.exit(1)

    # Set up workspace
    if args.workspace:
        workspace = args.workspace
    else:
        workspace = Path(f"{skill_name}-workspace") / "iteration-1"
    workspace.mkdir(parents=True, exist_ok=True)

    project_root = find_project_root()
    rule_file = args.rule_file.resolve()

    if args.verbose:
        print(f"Rule file: {rule_file}")
        print(f"Evals: {len(evals)} test cases")
        print(f"Workspace: {workspace}")
        print(f"Project root: {project_root}")
        print()

    # Submit all runs
    futures = {}
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        for eval_item in evals:
            eval_id = eval_item["id"]
            prompt = eval_item["prompt"]
            eval_dir = workspace / f"eval-{eval_id}"

            # Write eval metadata
            eval_dir.mkdir(parents=True, exist_ok=True)
            metadata = {
                "eval_id": eval_id,
                "eval_name": f"eval-{eval_id}",
                "prompt": prompt,
                "expected_output": eval_item.get("expected_output", ""),
                "assertions": eval_item.get("expectations", []),
            }
            (eval_dir / "eval_metadata.json").write_text(
                json.dumps(metadata, indent=2, ensure_ascii=False)
            )

            for config in ["with_rule", "without_rule"]:
                output_dir = eval_dir / config / "run-1" / "outputs"
                future = executor.submit(
                    run_single,
                    prompt=prompt,
                    eval_id=eval_id,
                    config=config,
                    rule_source=rule_file if config == "with_rule" else None,
                    project_root=project_root,
                    output_dir=output_dir,
                    timeout=args.timeout,
                    model=args.model,
                )
                futures[future] = (eval_id, config)

        # Collect results
        for future in as_completed(futures):
            eval_id, config = futures[future]
            try:
                result = future.result()
                status = "OK" if result["success"] else "FAIL"
                if args.verbose:
                    print(
                        f"  [{status}] eval-{eval_id} {config} "
                        f"({result['duration']:.1f}s, {result['total_tokens']} tokens)"
                    )
            except Exception as e:
                print(f"  [ERROR] eval-{eval_id} {config}: {e}", file=sys.stderr)

    print(f"\nResults saved to: {workspace}")
    print(f"Run eval-viewer to review:")
    print(f"  python <skill-creator-path>/eval-viewer/generate_review.py {workspace} --skill-name {skill_name}")


if __name__ == "__main__":
    main()
