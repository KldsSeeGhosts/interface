import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'

const repeatSource = stripTypeScriptTypes(await readFile(new URL('../src/lib/modules/navigation-repeat.ts', import.meta.url), 'utf8'))
const navigationSource = stripTypeScriptTypes(await readFile(new URL('../src/lib/modules/navigate.ts', import.meta.url), 'utf8'))

async function gate () {
  const module = new vm.SourceTextModule(repeatSource)
  await module.link(() => { throw new Error('Repeat gate must have no dependencies') })
  await module.evaluate()
  return module.namespace.createNavigationRepeatGate()
}

test('first press and each 100 ms gamepad repeat are accepted', async () => {
  const accept = await gate()
  assert.equal(accept('ArrowRight', false, 0), true)
  for (let now = 400; now <= 1400; now += 100) {
    assert.equal(accept('ArrowRight', true, now), true)
  }
})

test('native keyboard repeat rate is capped by elapsed time, not event count', async () => {
  const accept = await gate()
  assert.equal(accept('ArrowRight', false, 0), true)
  for (const now of [10, 20, 30, 40, 50, 60, 79]) {
    assert.equal(accept('ArrowRight', true, now), false)
  }
  assert.equal(accept('ArrowRight', true, 80), true)
  assert.equal(accept('ArrowRight', true, 159), false)
  assert.equal(accept('ArrowRight', true, 160), true)
})

test('small scheduling jitter does not halve 100 ms gamepad navigation', async () => {
  const accept = await gate()
  assert.equal(accept('ArrowRight', false, 0), true)
  for (const now of [400, 499, 601, 699, 801]) {
    assert.equal(accept('ArrowRight', true, now), true)
  }
})

test('quick taps and direction changes remain immediate', async () => {
  const accept = await gate()
  assert.equal(accept('ArrowRight', false, 0), true)
  assert.equal(accept('ArrowRight', false, 10), true)
  assert.equal(accept('ArrowLeft', true, 20), true)
  assert.equal(accept('ArrowRight', true, 30), true)
  assert.equal(accept('ArrowRight', true, 31), false)
})

test('independent navigation gates do not share held-key state', async () => {
  const first = await gate()
  const second = await gate()
  first('ArrowRight', false, 0)
  assert.equal(first('ArrowRight', true, 10), false)
  assert.equal(second('ArrowRight', true, 10), true)
})

async function navigationHarness () {
  let now = 0
  let navigationCalls = 0
  const listen = () => {}
  const document = {
    activeElement: null,
    querySelector: () => null,
    body: {
      querySelectorAll: () => { navigationCalls++; return [] }
    }
  }
  const context = vm.createContext({
    performance: { now: () => now },
    window: { addEventListener: listen },
    addEventListener: listen,
    matchMedia: () => ({ matches: false, addEventListener: listen }),
    document
  })
  const module = new vm.SourceTextModule(navigationSource, { context })
  await module.link(specifier => {
    if (specifier === './navigation-repeat') {
      return new vm.SourceTextModule(repeatSource, { context })
    }
    assert.equal(specifier, 'simple-store-svelte')
    return new vm.SyntheticModule(['writable'], function () {
      this.setExport('writable', value => ({ value }))
    }, { context })
  })
  await module.evaluate()
  return {
    get navigationCalls () { return navigationCalls },
    key (key, repeat, time) {
      now = time
      let prevented = false
      module.namespace.navigate({
        key,
        repeat,
        preventDefault () { prevented = true }
      })
      return prevented
    }
  }
}

test('actual navigate module processes every gamepad repeat rather than every eighth', async () => {
  const h = await navigationHarness()
  assert.equal(h.key('ArrowRight', false, 0), true)
  for (let now = 400; now <= 1400; now += 100) h.key('ArrowRight', true, now)
  assert.equal(h.navigationCalls, 12)
})

test('actual navigate module suppresses excessive repeats, not taps or other keys', async () => {
  const h = await navigationHarness()
  h.key('ArrowRight', false, 0)
  assert.equal(h.key('ArrowRight', true, 10), true)
  assert.equal(h.navigationCalls, 1)
  h.key('ArrowRight', false, 20)
  h.key('ArrowLeft', true, 30)
  assert.equal(h.navigationCalls, 3)
  assert.equal(h.key('Enter', false, 40), false)
  assert.equal(h.navigationCalls, 3)
})
