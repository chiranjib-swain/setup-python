import {describe, expect, it} from '@jest/globals';
import {fileURLToPath} from 'url';
import fs from 'fs';
import path from 'path';

interface ProblemPattern {
  regexp: string;
  file?: number;
  line?: number;
  message?: number;
}

interface ProblemMatcher {
  owner: string;
  pattern: ProblemPattern[];
}

interface Finding {
  owner: string;
  file: string;
  line: string;
  message: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const matcherFile = path.join(__dirname, '..', '.github', 'python.json');
const matchers = (
  JSON.parse(fs.readFileSync(matcherFile, 'utf8')) as {
    problemMatcher: ProblemMatcher[];
  }
).problemMatcher;

function findProblems(lines: string[]): Finding[] {
  const findings: Finding[] = [];

  for (const matcher of matchers) {
    const patterns = matcher.pattern.map(pattern => ({
      ...pattern,
      regex: new RegExp(pattern.regexp)
    }));

    for (let start = 0; start <= lines.length - patterns.length; start++) {
      const matches = patterns.map((pattern, offset) =>
        pattern.regex.exec(lines[start + offset])
      );

      if (!matches.every((match): match is RegExpExecArray => match !== null)) {
        continue;
      }

      const capturedValue = (field: 'file' | 'line' | 'message'): string => {
        const patternIndex = patterns.findIndex(pattern => pattern[field]);
        if (patternIndex < 0) {
          return '';
        }

        const captureIndex = patterns[patternIndex][field];
        return captureIndex ? matches[patternIndex][captureIndex] : '';
      };

      findings.push({
        owner: matcher.owner,
        file: capturedValue('file'),
        line: capturedValue('line'),
        message: capturedValue('message')
      });
    }
  }

  return findings;
}

describe('Python problem matcher', () => {
  it('uses unique owners for each traceback layout', () => {
    expect(matchers.map(matcher => matcher.owner)).toEqual([
      'python-range',
      'python'
    ]);
  });

  it.each([
    'AssertionError: assertion failed',
    "AttributeError: 'NoneType' object has no attribute 'upper'",
    'Exception: custom exception',
    "FileNotFoundError: [Errno 2] No such file or directory: 'missing.txt'",
    "ImportError: cannot import name 'missing' from 'module'",
    'IndexError: list index out of range',
    "KeyError: 'theme'",
    "ModuleNotFoundError: No module named 'missing'",
    'RuntimeError: runtime failure',
    "SyntaxError: '(' was never closed",
    "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
    "ValueError: invalid literal for int() with base 10: 'text'",
    'ZeroDivisionError: division by zero'
  ])('matches a classic traceback ending in %s', message => {
    expect(
      findProblems([
        'Traceback (most recent call last):',
        '  File "tests/example.py", line 7, in <module>',
        '    fail()',
        message
      ])
    ).toEqual([
      {
        owner: 'python',
        file: 'tests/example.py',
        line: '7',
        message
      }
    ]);
  });

  it('skips a modern range indicator and captures the exception', () => {
    expect(
      findProblems([
        'Traceback (most recent call last):',
        '  File "tests/index_error.py", line 3, in <module>',
        '    items[1]',
        '    ~~~~~^^^',
        'IndexError: list index out of range'
      ])
    ).toEqual([
      {
        owner: 'python-range',
        file: 'tests/index_error.py',
        line: '3',
        message: 'IndexError: list index out of range'
      }
    ]);
  });

  it('captures a SyntaxError instead of its caret', () => {
    expect(
      findProblems([
        '  File "tests/syntax_error.py", line 2',
        '    print("unclosed"',
        '         ^',
        "SyntaxError: '(' was never closed"
      ])
    ).toEqual([
      {
        owner: 'python-range',
        file: 'tests/syntax_error.py',
        line: '2',
        message: "SyntaxError: '(' was never closed"
      }
    ]);
  });

  it('uses the deepest matching frame in a nested traceback', () => {
    expect(
      findProblems([
        'Traceback (most recent call last):',
        '  File "tests/nested.py", line 8, in <module>',
        '    divide()',
        '  File "tests/nested.py", line 4, in divide',
        '    10 / 0',
        '    ~~~^~~',
        'ZeroDivisionError: division by zero'
      ])
    ).toEqual([
      {
        owner: 'python-range',
        file: 'tests/nested.py',
        line: '4',
        message: 'ZeroDivisionError: division by zero'
      }
    ]);
  });

  it('matches each standard segment in a chained traceback', () => {
    expect(
      findProblems([
        'Traceback (most recent call last):',
        '  File "tests/chained.py", line 2, in <module>',
        '    1 / 0',
        'ZeroDivisionError: division by zero',
        '',
        'The above exception was the direct cause of the following exception:',
        '',
        'Traceback (most recent call last):',
        '  File "tests/chained.py", line 4, in <module>',
        '    raise RuntimeError("wrapped")',
        'RuntimeError: wrapped'
      ])
    ).toEqual([
      {
        owner: 'python',
        file: 'tests/chained.py',
        line: '2',
        message: 'ZeroDivisionError: division by zero'
      },
      {
        owner: 'python',
        file: 'tests/chained.py',
        line: '4',
        message: 'RuntimeError: wrapped'
      }
    ]);
  });

  it.each([
    [
      'package.errors.CustomFailure: failed',
      'package.errors.CustomFailure: failed'
    ],
    ['KeyboardInterrupt', 'KeyboardInterrupt']
  ])('matches the exception line %s', (message, expectedMessage) => {
    expect(
      findProblems([
        '  File "tests/custom.py", line 5, in <module>',
        '    fail()',
        message
      ])[0].message
    ).toBe(expectedMessage);
  });

  it('matches an exception without a message', () => {
    expect(
      findProblems([
        'Traceback (most recent call last):',
        '  File "tests/no_message.py", line 1, in <module>',
        '    raise ValueError',
        'ValueError'
      ])
    ).toEqual([
      {
        owner: 'python',
        file: 'tests/no_message.py',
        line: '1',
        message: 'ValueError'
      }
    ]);
  });

  it.each(['BuildError', 'CustomException', 'UserWarning', 'Warning'])(
    'matches a custom %s without a message',
    message => {
      expect(
        findProblems([
          'Traceback (most recent call last):',
          '  File "tests/custom.py", line 4, in <module>',
          `    raise ${message}`,
          message
        ])
      ).toEqual([
        {
          owner: 'python',
          file: 'tests/custom.py',
          line: '4',
          message
        }
      ]);
    }
  );

  it.each([
    'Done',
    'Summary',
    'Success',
    'Completed',
    'ErrorMessage',
    'WarningMessage',
    'ExceptionDetails'
  ])('does not match ordinary output ending in %s', message => {
    expect(
      findProblems([
        '  File "tests/lookalike.py", line 4, in report',
        '    informational context',
        message
      ])
    ).toEqual([]);
  });

  it('captures Windows paths', () => {
    expect(
      findProblems([
        '  File "D:\\work\\project\\app.py", line 12, in <module>',
        '    fail()',
        'RuntimeError: failed'
      ])[0]
    ).toMatchObject({
      file: 'D:\\work\\project\\app.py',
      line: '12'
    });
  });

  it.each([
    [
      'traceback-shaped ordinary output',
      [
        '  File "tests/lookalike.py", line 4, in report',
        '    informational context',
        'not actually a Python exception'
      ]
    ],
    [
      'a whitespace-only range indicator',
      [
        '  File "tests/example.py", line 4, in <module>',
        '    fail()',
        '         ',
        'RuntimeError: failed'
      ]
    ],
    [
      'logger-prefixed traceback',
      [
        'ERROR:  File "tests/example.py", line 4, in report',
        'ERROR:    fail()',
        'ERROR:RuntimeError: failed'
      ]
    ]
  ])('does not match %s', (_name, lines) => {
    expect(findProblems(lines as string[])).toEqual([]);
  });
});
