# Python problem matcher update

> **Review only:** This document is a temporary reference for reviewing and preparing the change. Will remove it before opening the main pull request.

## Summary

This change improves the Python problem matcher so standard traceback output is annotated correctly across older and newer Python versions, while reducing false-positive annotations.

## Changes compared with `main`

### Python 3.11+ fine-grained error locations

Python 3.11 and later may insert a `^` and `~` location indicator between the source line and the exception:

```text
  File "example.py", line 3, in <module>
    items[1]
    ~~~~~^^^
IndexError: list index out of range
```

The new `python-range` matcher consumes this four-line layout and reports the actual exception instead of the range indicator.

### Standard traceback exception lines

The matcher on `main` expects the source line to resemble:

```text
raise Exception('message')
```

That misses common exceptions produced by arbitrary expressions, such as:

```text
10 / 0
items[1]
int("text")
```

The updated `python` matcher recognizes the standard three-line traceback ending:

```text
  File "example.py", line 3, in <module>
    failing_expression()
ExceptionType: message
```

### Complete exception messages

The previous matcher extracts only a quoted argument from a specific `raise` statement. The new patterns capture the complete final exception line:

```text
ValueError: invalid literal for int() with base 10: 'text'
```

This supports built-in exceptions, qualified custom exception names, and message-less exceptions.

### False-positive reduction

The final line must resemble a Python exception name, optionally followed by a message. Ordinary traceback-shaped output such as the following is rejected:

```text
  File "example.py", line 4, in report
    informational context
not actually a Python exception
```

### Matcher owners

The matcher file defines two unique owners:

- `python-range` for traceback endings containing a fine-grained location line.
- `python` for classic traceback endings without that line.

Unique owners are required because registering another problem matcher with the same owner replaces the existing matcher.

## Comparison with pull request 420

[Pull request 420](https://github.com/actions/setup-python/pull/420) correctly identifies the main limitation of the matcher on `main`: requiring a source line shaped like `raise Exception('message')` misses most real Python exceptions. Both pull request 420 and this update allow arbitrary four-space-indented source lines.

Pull request 420 proposes one three-line matcher:

1. A `File` frame.
2. A four-space-indented source line.
3. Any following line that is not another `File` frame.

Its final pattern is:

```text
^(?!  File)(.*)\s*$
```

This broad final line improves classic traceback coverage, but it cannot distinguish an exception from a Python 3.11+ range indicator or ordinary traceback-shaped output. The pull request description acknowledges the caret-line limitation.

| Behavior | Matcher on `main` | Pull request 420 | This update |
| --- | --- | --- | --- |
| Arbitrary traceback source expressions | No | Yes | Yes |
| Classic three-line traceback endings | Limited to specific `raise` statements | Yes | Yes |
| Python 3.11+ `^` and `~` range lines | No | Captures the range line as the message | Consumes the range line and captures the exception |
| `SyntaxError` caret lines | No annotation | Captures the caret as the message | Captures the complete `SyntaxError` message |
| Traceback-shaped ordinary output | Usually not matched | Can produce a false positive | Rejected unless the final line is exception-shaped |
| Nested modern tracebacks | No | Can annotate intermediate range lines | Reports the exception from the deepest matching frame |
| Matcher layouts | One narrow layout | One broad three-line layout | Separate three-line and four-line layouts |
| Automated matcher tests | None | None | 24 contract cases |

The current implementation keeps pull request 420's useful frame and context-line approach, then narrows the final line to an exception-shaped identifier. It also adds a separate `python-range` owner for the four-line layout because GitHub problem matcher patterns do not provide a practical optional-line construct for this case.

### Hosted comparison evidence

- [Pull request 420 on Python 3.10](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31475973490)
- [Pull request 420 on Python 3.14](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31476024765)

Both workflows execute `eric-wieser/setup-python@patch-1`, the branch used by pull request 420. The runtime jobs produced these results:

| Case | Python 3.10 | Python 3.14 |
| --- | --- | --- |
| `IndexError` | Correct exception message | Reports `~~~~~^^^` |
| Nested traceback | Reports the deepest `ZeroDivisionError` | Reports range indicators from two frames |
| Chained traceback | Reports both exception messages | Reports `~~^~~` for the first exception and the correct second exception |
| `SyntaxError` | Reports `^` | Reports `^` |
| Windows path | Correct annotation | Correct annotation |
| Traceback-shaped ordinary output | Incorrectly annotated | Incorrectly annotated |

Representative source annotations were:

```text
Python 3.10
tests/syntax_error.py:2        message:          ^
tests/traceback_lookalike.py:4 message: not actually a Python exception

Python 3.14
tests/index_error.py:3         message:     ~~~~~^^^
tests/nested_error.py:2        message:            ~~~^~~
tests/nested_error.py:5        message:     ~~~~~~~~~~~~~~^^
tests/chained_error.py:2       message:     ~~^~~
tests/traceback_lookalike.py:4 message: not actually a Python exception
```

The workflows have an overall failure conclusion because the fixtures intentionally raise exceptions. Their `Validate matcher` jobs also use a two-matcher count assertion intended for the current candidate, so those jobs are not evidence for or against pull request 420's single-matcher configuration. The runtime source annotations are the relevant comparison evidence.

These results show that pull request 420 broadens traceback detection as intended, but reports location indicators as messages on modern Python and accepts traceback-shaped ordinary prose. The current implementation was tested against the same categories and reports the actual exception messages while rejecting the ordinary-output fixture.

## Permanent contract tests

`__tests__/problem-matcher.test.ts` loads the real `.github/python.json` configuration and simulates GitHub's consecutive multiline matching behavior.

Its 24 cases cover:

- Classic Python tracebacks.
- Python 3.11+ range indicators.
- `SyntaxError` caret handling.
- Thirteen common exception types.
- Nested tracebacks and selection of the deepest frame.
- Chained tracebacks containing multiple exception blocks.
- Qualified custom exception names.
- Message-less exceptions such as `KeyboardInterrupt`.
- Windows paths.
- Traceback-shaped ordinary output rejection.
- Custom logger prefix rejection.
- The current `ExceptionGroup` boundary.
- Unique matcher owners.

`ExceptionGroup` remains an explicit non-match test but is not called out in the main README because no repository demand for that format was found.

## Documentation

The README explains that the action creates file and line annotations, supports standard traceback formats including Python 3.11+ fine-grained locations, and does not support tracebacks with custom prefixes or indentation.

## Local validation

The following checks passed on the completed change:

```text
npm run format-check
npm run lint
npm test
npm run build
git diff --check
```

Results:

- Full Jest suite: 234 tests passed across 11 suites.
- Matcher contract suite: 24 tests passed.
- ESLint passed.
- Prettier passed.
- Both production `ncc` bundles built successfully.
- The build produced no tracked bundle differences.
- The Git diff contained no whitespace errors.

## Hosted workflow validation

The external workflow uses the matcher from commit `6f05d76b2ee0dad4076c70077171b67fc0bfeeaa`.

- [Python 3.10 hosted run](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31474510211)
- [Python 3.14 hosted run](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31474513761)

Both runs confirmed:

- Matcher configuration validation passed.
- Chained tracebacks produced `ZeroDivisionError: division by zero` at line 2.
- Chained tracebacks produced `RuntimeError: wrapped` at line 4.
- Windows tracebacks produced `RuntimeError: windows path failure` at line 1.
- GitHub normalized the native Windows path to `tests/windows_path_error.py` in the annotation API.

The raw Windows traceback used a native runner path similar to:

```text
D:\a\test-setup-python\test-setup-python\tests\windows_path_error.py
```

The hosted workflows are intentionally red because their fixtures raise uncaught exceptions. The expected result is the matcher-created source annotations, not a successful workflow conclusion. The matcher validation jobs themselves passed.

## False-positive comparison

- [Pull request 420 on Python 3.10](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31475973490)
- [Pull request 420 on Python 3.14](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31476024765)

The compared matcher incorrectly annotated the following ordinary text at `tests/traceback_lookalike.py:4`:

```text
not actually a Python exception
```

The updated matcher rejects that output and produces no source annotation.

Earlier candidate runs used for broad Python 3.10 and 3.14 coverage:

- [Earlier Python 3.10 run](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31167186996)
- [Earlier Python 3.14 run](https://github.com/chiranjib-swain/test-setup-python/actions/runs/31167188940)

## Known boundary

Problem matcher patterns consume consecutive lines with fixed layouts. Tracebacks whose lines are all prefixed or re-indented by a custom logging handler are not supported.

Standard `logging.exception()` output was checked and retains the normal traceback indentation, so it remains compatible. Fully rewritten logger output is outside the supported format.

## PR checklist

Before opening the pull request:

- Add `__tests__/problem-matcher.test.ts` to Git.
- Commit the README and this reference document.
- Push the final commit to `python-matcher-update`.
- Confirm the pull request diff contains `.github/python.json`, the contract test, README documentation, and this reference document if it is intended to be included in the PR.
- Explain that the external hosted workflows are expected to have an overall failure conclusion because the fixtures intentionally raise exceptions.
