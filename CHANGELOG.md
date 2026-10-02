# Changelog

## 0.1.1-vba.5 (fork)

- Changed history drawing to put one blank row between segments, whatever blank lines were typed between them, so two code blocks typed back to back no longer read as one card

## 0.1.1-vba.4 (fork)

- Changed history drawing to colour code itself: a sent message is cut into prose (drawn with the `Markdown` element) and code blocks (drawn as runs coloured by the prompt box's own highlighter, VBA included, on the code card background). The engine's highlighter is off for anyone with `syntaxHighlightingDisabled`, and knows no VBA, so code drawn through `Markdown` stayed plain
- Fixed history drawing being skipped in the normal view: `isExpanded` is true only under ctrl+o / --verbose, so the person's own prompt is drawn whatever it says (0.1.1-vba.3)
- Added `/md-prompt history debug`: a session-only toast per drawn message saying what the history hook decided (0.1.1-vba.3)

## 0.1.1-vba.2 (fork)

- Added drawing your sent messages again as Markdown: a `ui.render` hook on `UserMessage` draws a message of your own (typed here, or sent over Remote Control) that holds a code fence with the `Markdown` element, the renderer replies use, so its code is highlighted in the transcript too. With VBA detection on, an unfenced VBA procedure is wrapped in a ```` ```vba ```` fence for the drawing. Only the drawing changes: the stored message and what the model reads stay as typed. Messages without code, notification rows and messages over 10,000 characters keep Claude Code's own drawing
- Added the `history` setting (`/config`, "Markdown in history", default on) and `/md-prompt history on | off | toggle`

## 0.1.1-vba.1 (fork: shostako/md-prompt)

- Added VBA highlighting for fenced code: ```` ```vba ````, `vb`, `vbs`, `vbscript`, `bas`, `cls`, `frm`, `vb.net`, `visual-basic`. Keywords are case-insensitive and a word after `.` or `!` is a member, not a keyword; `'` and `Rem` comments; strings with `""` and no backslash escapes; `&H` / `&O` numbers and type suffixes; `#date#` literals, `#If` directives and line labels; `vb…` / `xl…` / `mso…` constants as literals
- Added detection of VBA procedures typed without a fence: from a `Sub` / `Function` / `Property Get|Let|Set` header line (optionally `Public` / `Private` / `Friend`, `Static`) to its matching `End` line, painted as a VBA code card once the `End` line is typed. Lines inside a fence never count, and Markdown runs are cut back to the text outside the procedure, so `a * b` is never emphasis
- Added the `vba` setting (`/config`, "VBA detection", default on) and `/md-prompt vba on | off | toggle`; `/md-prompt` now reports it too
- Marketplace renamed to `shostako`: install as `md-prompt@shostako`

## 0.1.1

- Added task boxes without a bullet: a `[ ]` or `[x]` opening a line is painted like `- [ ]` and `- [x]`, so a checklist typed as `[ ] todo` gets its boxes too

## 0.1.0

- Added painting of fenced code blocks in the prompt box: a card with a fixed background and syntax colours, painted from the opening fence on, so a block still being typed is already coloured; `~~~` fences, indented code, and fences inside lists and quotes work too
- Added syntax highlighting for TypeScript/JavaScript, Python, shell, JSON, YAML, TOML/INI, Go, Rust, Swift, the C and Java families, SQL, Ruby, Lua, HCL, PowerShell, GraphQL, Elixir, Haskell, Zig, R, Perl, nginx, Protobuf, HTML/XML, CSS/SCSS/Less, Markdown, Dockerfile, Makefile and `diff`; other languages get strings and numbers only
- Added the rest of everyday Markdown: inline code, bold, italic, bold italic and strikethrough by CommonMark's rules (nested, across the lines of a paragraph), bullet, numbered and task lists, quotes, headings of every level, rules, tables, links of every kind (inline, reference, autolink, bare URL), images, footnotes, inline HTML and entities; the Markdown markers are dimmed rather than hidden, and the text you type is never changed
- Added guards so prose that only looks like Markdown stays plain (`2*3*4`, `src/*.ts`, `__init__`, `Array<string>`, `arr[i][j]`, `$5`, `~/path`), and a linear-time scan that stays fast on hostile input
- Added `/md-prompt on | code | off | toggle`: everything, code only, or nothing; the mode is the plugin's "Markdown painting" setting, a row in /config, so it is kept across sessions
- Added tests: the pure logic including differential checks against commonmark.js and a fuzz run, the hooks through `claude plugin test`, and a colour-contrast floor so the colours that sit on the terminal background stay readable on light and dark themes
- Added CI that runs those tests, validates the marketplace and the plugin, and type-checks the plugin on every push and pull request, and weekly against the latest Claude Code
