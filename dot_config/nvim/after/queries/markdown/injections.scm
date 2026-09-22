; extends

; MDX ESM blocks and JSX/expressions share the Markdown parser.
((inline) @injection.content
  (#mdx?)
  (#lua-match? @injection.content "^%s*import%s")
  (#set! injection.language "tsx")
  (#set! injection.include-children))

((inline) @injection.content
  (#mdx?)
  (#lua-match? @injection.content "^%s*export%s")
  (#set! injection.language "tsx")
  (#set! injection.include-children))

((inline) @injection.content
  (#mdx?)
  (#lua-match? @injection.content "^%s*[<{]")
  (#set! injection.language "tsx")
  (#set! injection.include-children))

((html_block) @injection.content
  (#mdx?)
  (#set! injection.language "tsx")
  (#set! injection.include-children))

((indented_code_block) @injection.content
  (#mdx?)
  (#lua-match? @injection.content "^%s*<")
  (#set! injection.language "tsx")
  (#set! injection.include-children))
