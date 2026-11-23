import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { diagramSource, isDiagramLanguage, maxDiagramBytes } from './diagram'

const other = 'http://127.0.0.1:4999'

describe('diagram fences', () => {
  test('only mermaid fences draw as diagrams', () => {
    assert.equal(isDiagramLanguage('mermaid'), true)
    assert.equal(isDiagramLanguage('Mermaid'), true)
    assert.equal(isDiagramLanguage('js'), false)
    assert.equal(isDiagramLanguage(undefined), false)
  })
})

describe('diagram source check', () => {
  test('ordinary diagrams pass unchanged', () => {
    const diagrams = [
      'flowchart TD\n  A[Start] -->|yes| B(Done)\n  B --> C{Ask}',
      'sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello',
      'classDiagram\n  Animal <|-- Duck\n  Animal : +int age',
      'stateDiagram-v2\n  [*] --> Still\n  Still --> [*]',
      'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
      'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2026-01-01, 3d',
      'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85',
      'flowchart LR\n  A[my image (x)] --> B[src code]\n  style A fill:#f9f,stroke:#333',
    ]
    for (const source of diagrams) assert.equal(diagramSource(source), source)
  })

  test('directives are removed: only the app sets configuration', () => {
    const source = `%%{init: {"themeCSS": ".node rect { fill: red }"}}%%\nflowchart TD\n  A --> B`
    assert.equal(diagramSource(source), '\nflowchart TD\n  A --> B')
    assert.equal(diagramSource('%%{ wrap }%%\nflowchart TD\n  A --> B')?.includes('%%{'), false)
  })

  test('front matter is removed', () => {
    const source = '---\ntitle: Hi\nconfig:\n  theme: forest\n---\nflowchart TD\n  A --> B'
    assert.equal(diagramSource(source), 'flowchart TD\n  A --> B')
    assert.equal(diagramSource('---\r\ntitle: Hi\r\n---\r\nflowchart TD'), 'flowchart TD')
  })

  test('the hostile sources found in Mermaid strict mode are refused or stripped', () => {
    // Each of these made the browser call another host while Mermaid laid it out.
    const directive = `%%{init: {"themeCSS": ".node rect { fill: url(${other}/a.png) }"}}%%\nflowchart TD\n  A --> B`
    const frontMatter = `---\nconfig:\n  themeCSS: ".node rect { fill: url(${other}/b.png) }"\n---\nflowchart TD\n  A --> B`
    const image = `flowchart TD\n  A@{ img: "${other}/c.png", label: "x" }`
    for (const source of [directive, frontMatter]) {
      const checked = diagramSource(source)
      assert.ok(checked !== null && !checked.includes(other) && !checked.includes('themeCSS'))
    }
    assert.equal(diagramSource(image), null)
  })

  test('anything that can name a resource is refused', () => {
    const refused = [
      `flowchart TD\n  A --> B\n  style A fill:url(${other}/d.png)`,
      `flowchart TD\n  A --> B\n  style A fill:URL ( //127.0.0.1:4999/e.png )`,
      'flowchart TD\n  A --> B\n  style A fill:u\\72l(//127.0.0.1:4999/f.png)',
      'flowchart TD\n  A --> B\n  classDef x background-image:image-set("//127.0.0.1:4999/g.png" 1x)',
      'flowchart TD\n  A --> B\n  classDef x background:-webkit-image-set("//h" 1x)',
      'flowchart TD\n  A --> B\n  classDef x background:cross-fade(red, blue)',
      'flowchart TD\n  A --> B\n  classDef x background:image("//h")',
      'flowchart TD\n  A --> B\n  classDef x @import "x.css"',
      `flowchart TD\n  A --> B\n  click A "${other}/h" _blank`,
      `sequenceDiagram\n  Alice->>Bob: Hi\n  link Alice: Site @ ${other}/i`,
      `flowchart TD\n  A[See ${other}/j]`,
      'flowchart TD\n  A@{ icon: "fa:user", form: "square" }',
      "flowchart TD\n  A@{ shape: rect, IMG: '//h' }",
    ]
    assert.deepEqual(
      refused.filter((source) => diagramSource(source) !== null),
      [],
    )
  })

  test('configuration that would survive stripping is refused', () => {
    const refused = [
      // An unclosed directive still configures Mermaid.
      `%%{init: {"themeCSS": ".a{}"}\nflowchart TD\n  A --> B`,
      // A second front-matter block becomes the first.
      '---\ntitle: a\n---\n---\nconfig:\n  theme: dark\n---\nflowchart TD',
    ]
    assert.deepEqual(
      refused.filter((source) => diagramSource(source) !== null),
      [],
    )
    // Removing one directive leaves no other behind; indented front matter is front matter too.
    const stripped = [
      '%%{%%{init: {}}%%init: {}}%%\nflowchart TD',
      '  ---\nconfig: {}\n  ---\nflowchart TD',
    ]
    for (const source of stripped) {
      const checked = diagramSource(source)
      assert.ok(checked !== null && !checked.includes('%%{') && !checked.includes('config'))
    }
  })

  test('an empty or over-long source shows as code', () => {
    assert.equal(diagramSource(''), null)
    assert.equal(diagramSource('%%{init: {}}%%\n'), null)
    const long = `flowchart TD\n${'  A --> B\n'.repeat(maxDiagramBytes / 10)}`
    assert.equal(diagramSource(long), null)
  })
})
