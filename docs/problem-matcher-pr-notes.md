# Python problem matcher update

> **Review only:** This document is a temporary reference for reviewing and preparing the change. Will remove it before opening the main pull request.

## Summary

This change improves the Python problem matcher so standard traceback output is annotated correctly across older and newer Python versions, while reducing false-positive annotations.

## Changes compared with `main`

- Replace the narrow matcher that requires a source line shaped like `raise Exception('message')`.
- Add `python` for standard three-line traceback endings.
- Add `python-range` for Python 3.11+ tracebacks containing a `^`/`~` location line.
- Capture complete exception lines, including qualified custom exceptions with messages and common message-less builtins.
- Require an exception-shaped final line to reject traceback-like ordinary output.

The two layouts need unique owners because registering another matcher with the same owner replaces the existing matcher.

## Comparison with pull request 420

[Pull request 420](https://github.com/actions/setup-python/pull/420) correctly identifies the main limitation of the matcher on `main`: requiring a source line shaped like `raise Exception('message')` misses most real Python exceptions. Both pull request 420 and this update allow arbitrary four-space-indented source lines.

PR 420 uses one three-line matcher and accepts any final line that is not another `File` frame. This improves classic traceback coverage, but cannot distinguish an exception from a Python 3.11+ range indicator or ordinary prose. Its description acknowledges the caret-line limitation.

| Behavior | Matcher on `main` | Pull request 420 | This update |
| --- | --- | --- | --- |
| Arbitrary traceback source expressions | No | Yes | Yes |
| Python 3.11+ `^` and `~` range lines | No | Captures the range line as the message | Consumes the range line and captures the exception |
| `SyntaxError` caret lines | No annotation | Captures the caret as the message | Captures the complete `SyntaxError` message |
| Traceback-shaped ordinary output | Usually not matched | Produces a false positive | Rejected |
| Matcher layouts | One narrow layout | One broad three-line layout | Separate three-line and four-line layouts |
| Automated matcher tests | None | None | 36 contract cases |

This implementation keeps PR 420's frame and context-line approach, narrows the final line to an exception-shaped identifier, and uses a separate matcher for the four-line layout.

## Hosted evidence

### Pull request 420

- [Pull request 420 on Python 3.10](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31574512952)
- [Pull request 420 on Python 3.14](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31574516135)

Both workflows checked out and validated the single matcher at `eric-wieser/setup-python@patch-1` commit `82009b3bde52ba09eae338d59adb1c06ac50c997`.

| Case | Python 3.10 | Python 3.14 |
| --- | --- | --- |
| `IndexError` | Correct exception message | Reports `~~~~~^^^` |
| Nested traceback | Correct exception message | Reports range indicators from two frames |
| Chained traceback | Reports both exception messages | Reports `~~^~~` for the first exception and the correct second exception |
| `SyntaxError` | Reports `^` | Reports `^` |
| Windows path | Correct annotation | Correct annotation |
| Traceback-shaped ordinary output | Incorrectly annotated | Incorrectly annotated |

The validation jobs passed. The runs are intentionally red because the runtime fixtures raise exceptions.

### This update

The external workflow uses the matcher from commit `6f05d76b2ee0dad4076c70077171b67fc0bfeeaa`.

- [Python 3.10 hosted run](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31474510211)
- [Python 3.14 hosted run](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31474513761)

Both runs confirmed:

- Matcher configuration validation passed.
- Chained tracebacks produced both exception annotations at the correct lines.
- Windows tracebacks produced `RuntimeError: windows path failure` at line 1.
- Native Windows paths were normalized correctly by GitHub.
- Python 3.11+ range indicators were skipped in favor of the actual exception message.
- Traceback-shaped ordinary output produced no source annotation.

These workflows are also intentionally red because the fixtures raise uncaught exceptions; the matcher validation jobs passed.

## Tests and documentation

`__tests__/problem-matcher.test.ts` loads `.github/python.json` and simulates consecutive multiline matching. Its 36 cases cover classic and modern tracebacks, 13 common exceptions, `SyntaxError`, nested and chained errors, qualified exceptions with messages, message-less exceptions, suffix boundaries, Windows paths, and negative cases.

The README documents standard traceback support, Python 3.11+ fine-grained locations, and the custom prefix/indentation limitation.

Validation completed:

- 246 Jest tests passed across 11 suites.
- ESLint and Prettier passed.
- Both production `ncc` bundles built without tracked changes.

## Known boundary

Problem matcher patterns consume consecutive lines with fixed layouts. Tracebacks whose lines are all prefixed or re-indented by a custom logging handler are not supported.

Standard `logging.exception()` output was checked and retains the normal traceback indentation, so it remains compatible. Fully rewritten logger output is outside the supported format.
