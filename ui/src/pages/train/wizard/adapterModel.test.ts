// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0

// NOTE on ordering: getBackendAdapterFamilyCapabilities() is backed by
// module-level state in schemaCommon (no public reset).  These tests therefore
// run backend-absent / malformed cases BEFORE any test that installs a valid
// backend payload, and the backend-present suite installs its own payload at the
// start.  Do not reorder those blocks.

import {
  applyBackendConfigOptions,
  getAdapterFamilyCapabilities,
  getBackendAdapterFamilyCapabilities,
  getFieldDefinition,
} from '@/schema/schemaIndex.js'
import {
  normalizeAdapterEntityMutex,
  normalizeAdapterFamily as schemaNormalizeAdapterFamily,
  resolveWinningAdapterEntity,
} from '@/schema/schemaCommon.js'
import {
  adapterCategoryForFamily,
  adapterOptions,
  buildAdapterSelection,
  groupAdapterOptionsByCategory,
  normalizeAdapterFamily,
  type AdapterCategoryKey,
  type AdapterOption,
} from './adapterModel'

function findCard(cards: AdapterOption[], family: string): AdapterOption {
  const found = cards.find((card) => card.family === family)
  if (!found) throw new Error(`expected card family ${family}, got ${cards.map((c) => c.family).join(',')}`)
  return found
}

describe('adapterModel backend-absent (local fallback)', () => {
  test('families in the merged fallback are available, unknown families are legacy', () => {
    // Backend must be empty here: this block runs before any backend payload is applied.
    expect(Object.keys(getBackendAdapterFamilyCapabilities())).toHaveLength(0)
    const merged = getAdapterFamilyCapabilities()
    const cards = adapterOptions({}, 'sdxl-lora')
    const families = new Set(cards.map((c) => c.family))
    expect(families.has('lora')).toBe(true)
    expect(families.has('locon')).toBe(true)

    const lora = findCard(cards, 'lora')
    expect(lora.compatibility).toBe('available')
    const locon = findCard(cards, 'locon')
    expect(locon.compatibility).toBe('available')

    // In fallback -> available.
    expect(merged.lora).toBeTruthy()
    // Not in fallback -> legacy (still selectable).
    const vera = findCard(cards, 'vera')
    expect(vera.compatibility).toBe('legacy')
    expect(merged.vera).toBeFalsy()
    const reslora = findCard(cards, 'reslora')
    expect(reslora.compatibility).toBe('legacy')
  })
})

describe('adapterModel malformed capability payload', () => {
  test('non-object adapter_families payload is ignored and falls back to local capabilities', () => {
    const changed = applyBackendConfigOptions({ adapter_families: ['lora', 'dora'] })
    expect(changed).toBe(false)
    expect(Object.keys(getBackendAdapterFamilyCapabilities())).toHaveLength(0)
    const cards = adapterOptions({}, 'sdxl-lora')
    expect(findCard(cards, 'lora').compatibility).toBe('available')
    expect(findCard(cards, 'vera').compatibility).toBe('legacy')
  })

  test('capability entries that are not objects are dropped, not a crash source', () => {
    applyBackendConfigOptions({ adapter_families: { lora: 'not-an-object', vera: 42 } })
    expect(Object.keys(getBackendAdapterFamilyCapabilities())).toHaveLength(0)
    const cards = adapterOptions({}, 'sdxl-lora')
    expect(cards.length).toBeGreaterThan(0)
    expect(findCard(cards, 'locon').compatibility).toBe('available')
  })
})

describe('adapterModel alias normalization parity', () => {
  test('normalization is identical to schemaCommon for known aliases', () => {
    // Same function object — no drift possible.
    expect(normalizeAdapterFamily).toBe(schemaNormalizeAdapterFamily)
    for (const value of ['rs_lora', 'rslora', 'networks.vera', 'lora_plus']) {
      expect(normalizeAdapterFamily(value)).toBe(schemaNormalizeAdapterFamily(value))
    }
  })

  test('identity card families are derived through the same normalization space', () => {
    // sdxl-lora exposes network_module based families; verify the normalized ids.
    const cards = adapterOptions({}, 'sdxl-lora')
    const families = new Set(cards.map((c) => c.family))
    expect(families.has('lora')).toBe(true)
    expect(families.has('diag-oft')).toBe(true)
    expect(families.has('locon')).toBe(true)
  })

  test('adapterCategoryForFamily maps all known families strictly into lora, lycoris, or other', () => {
    const allKnownFamilies = [
      'lora', 'dora', 'rs-lora', 'lora-plus', 'lora-fa', 'vera', 'tlora', 'flexrank',
      'fera', 'hydralora', 'gdlokr', 'reslora', 'lora2', 'lora2-adaptive', 'tensorring',
      'dokr', 'cdka', 'krona', 'locon', 'loha', 'lokr', 'glora', 'glokr', 'ia3',
      'full', 'diag-oft',
    ]

    const expectedLora = new Set(['lora', 'dora', 'rs-lora', 'lora-plus'])
    const expectedLycoris = new Set([
      'loha', 'lokr', 'glora', 'glokr', 'ia3', 'full', 'diag-oft', 'locon',
      'dokr', 'gdlokr', 'cdka', 'krona', 'tensorring',
    ])

    for (const fam of allKnownFamilies) {
      const cat = adapterCategoryForFamily(fam)
      expect(['lora', 'lycoris', 'other']).toContain(cat)
      if (expectedLora.has(fam)) {
        expect(cat).toBe('lora')
      } else if (expectedLycoris.has(fam)) {
        expect(cat).toBe('lycoris')
      } else {
        expect(cat).toBe('other')
      }
    }
  })

  test('all adapterOptions across every training type map into exactly one category', () => {
    const types = ['sdxl-lora', 'anima-lora', 'flux-lora', 'concept-edit', 'yolo', 'minimax-h3-lora']
    for (const typeId of types) {
      const options = adapterOptions({}, typeId)
      const grouped = groupAdapterOptionsByCategory(options)
      const totalGrouped = grouped.lora.length + grouped.lycoris.length + grouped.other.length
      expect(totalGrouped).toBe(options.length)

      for (const opt of options) {
        const cat = adapterCategoryForFamily(opt.family)
        expect(['lora', 'lycoris', 'other']).toContain(cat)
        expect(grouped[cat]).toContain(opt)
      }
    }
  })
})

describe('adapterModel standard-LoRA selection', () => {
  test('selecting standard LoRA clears every entity flag and sets lora_type', () => {
    const cards = adapterOptions({ lora_type: 'lora' }, 'anima-lora')
    const lora = findCard(cards, 'lora')
    expect(lora.clears).toEqual(expect.arrayContaining([
      'vera_enabled',
      'tlora_enabled',
      'flexrank_lora_enabled',
      'fera_enabled',
      'hydralora_enabled',
      'gdlokr_enabled',
      'lora_fa_enabled',
      'reslora_enabled',
      'dokr_enabled',
      'cdka_enabled',
      'krona_enabled',
      'lora2_enabled',
      'tensorring_lora_enabled',
      'lora2_adaptive_enabled',
      'dora_enabled',
      'use_dora',
      'adalora_enabled',
      'delta_lora_enabled',
      'dora_wd',
    ]))
    const values = buildAdapterSelection(
      { lora_type: 'vera', vera_enabled: true, dora_enabled: true },
      lora,
    )
    expect(values.lora_type).toBe('lora')
    expect(values.vera_enabled).toBe(false)
    expect(values.dora_enabled).toBe(false)
    expect(values.use_dora).toBe(false)
    expect(values.dora_wd).toBe(false)
  })

  test('standard-LoRA selection resolves the mutex winner back to lora (bug #2 regression)', () => {
    const cards = adapterOptions({ lora_type: 'vera', vera_enabled: true }, 'anima-lora')
    const lora = findCard(cards, 'lora')
    const next = normalizeAdapterEntityMutex({
      ...{ lora_type: 'vera', vera_enabled: true },
      ...buildAdapterSelection({ lora_type: 'vera', vera_enabled: true }, lora),
    }) as Record<string, unknown>
    expect(next.vera_enabled).toBe(false)
    expect(resolveWinningAdapterEntity(next).id).toBe('lora')
  })
})

describe('adapterModel entity flag cards', () => {
  test('boolean-only entity flags become cards that write their flag and clear others (bug #3 regression)', () => {
    const cards = adapterOptions({}, 'sdxl-lora')
    const reslora = findCard(cards, 'reslora')
    expect(reslora.enables).toEqual(['reslora_enabled'])
    expect(reslora.clears).toEqual(expect.arrayContaining([
      'vera_enabled',
      'fera_enabled',
      'hydralora_enabled',
      'dokr_enabled',
      'cdka_enabled',
      'krona_enabled',
      'lora2_adaptive_enabled',
      'tensorring_lora_enabled',
      'dora_enabled',
      'use_dora',
      'adalora_enabled',
      'delta_lora_enabled',
      'dora_wd',
    ]))
    // own key is never cleared
    expect(reslora.clears).not.toContain('reslora_enabled')
    const values = buildAdapterSelection({ vera_enabled: true, dora_enabled: true }, reslora)
    expect(values.reslora_enabled).toBe(true)
    expect(values.vera_enabled).toBe(false)
    expect(values.dora_enabled).toBe(false)
    const next = normalizeAdapterEntityMutex({
      ...{ lora_type: 'lora', vera_enabled: true, dora_enabled: true },
      ...values,
    }) as Record<string, unknown>
    expect(resolveWinningAdapterEntity(next).id).toBe('reslora')
  })

  test('schema-backed boolean-only families are exposed as cards for sdxl-lora', () => {
    const cards = adapterOptions({}, 'sdxl-lora')
    const families = new Set(cards.map((c) => c.family))
    for (const expected of [
      'dora',
      'hydralora',
      'fera',
      'flexrank',
      'tlora',
      'lora-fa',
      'reslora',
      'dokr',
      'cdka',
      'krona',
      'tensorring',
      'lora2-adaptive',
    ]) {
      expect(families.has(expected), `expected card family ${expected}`).toBe(true)
    }
  })

  test('identity card for an entity family carries the flag enable plus identity fields', () => {
    const cards = adapterOptions({}, 'sdxl-lora')
    const vera = findCard(cards, 'vera')
    expect(vera.enables).toEqual(['vera_enabled'])
    expect(vera.values.network_module).toBe('networks.vera')
    expect(vera.clears).toEqual(expect.arrayContaining(['reslora_enabled', 'dora_enabled', 'use_dora', 'dora_wd']))
    expect(vera.clears).not.toContain('vera_enabled')
  })

  test('DoRA card claims the legacy dora_wd alias so the wizard renders one control', () => {
    // dora_wd is the network_args DoRA entry; the backend normalizer maps it onto
    // dora_enabled/use_dora, so both must not appear as separate wizard inputs.
    const cards = adapterOptions({}, 'sdxl-lora')
    const dora = findCard(cards, 'dora')
    expect(dora.enables).toEqual(['dora_enabled'])
    expect(dora.hides).toContain('dora_wd')
    expect(dora.hides).not.toContain('dora_enabled')
  })

  test('hides only lists alias keys the type schema actually defines', () => {
    // flux-lora has dora_wd but no dora_enabled master, so the DoRA family is not
    // projected as a card at all; other cards must not claim dora_wd either.
    const fluxCards = adapterOptions({}, 'flux-lora')
    expect(fluxCards.some((card) => card.family === 'dora')).toBe(false)
    for (const card of fluxCards) {
      expect(card.hides).not.toContain('dora_enabled')
    }

    // rs_lora / use_rslora are not schema fields anywhere, so the rsLoRA card
    // claims no aliases.
    const rsLora = findCard(adapterOptions({}, 'sdxl-lora'), 'rs-lora')
    expect(rsLora.enables).toEqual(['rs_lora_enabled'])
    expect(rsLora.hides).toEqual([])
  })

  test('every card exposes a hides array disjoint from its own enables', () => {
    for (const typeId of ['sdxl-lora', 'anima-lora', 'flux-lora', 'sd15-lora']) {
      for (const card of adapterOptions({}, typeId)) {
        expect(Array.isArray(card.hides)).toBe(true)
        for (const key of card.hides) {
          expect(card.enables).not.toContain(key)
        }
      }
    }
  })
})

describe('adapterModel disabled schema options', () => {
  test('disabled schema option becomes unsupported with its disabledReason', () => {
    const cards = adapterOptions({}, 'flux-lora')
    const diagOft = findCard(cards, 'diag-oft')
    expect(diagOft.compatibility).toBe('unsupported')
    expect(diagOft.disabledReason).toMatch(/FLUX OFT/)
  })
})

describe('adapterModel types without adapter fields', () => {
  test('types without adapter fields return an empty array', () => {
    expect(adapterOptions({}, 'yolo')).toHaveLength(0)
    expect(adapterOptions({}, 'minimax-h3-lora')).toHaveLength(0)
  })
})

describe('adapterModel selected state (winner-id based)', () => {
  test('selected follows resolveWinningAdapterEntity, not the lora_type string (bug #2 regression)', () => {
    // lora_type is still 'lora' but vera_enabled wins the entity mutex -> VeRA card selected.
    const cards = adapterOptions({ lora_type: 'lora', vera_enabled: true }, 'anima-lora')
    expect(resolveWinningAdapterEntity({ lora_type: 'lora', vera_enabled: true }).id).toBe('vera')
    expect(findCard(cards, 'vera').selected).toBe(true)
    expect(findCard(cards, 'lora').selected).toBe(false)
  })

  test('dora flag selects the dora card', () => {
    const cards = adapterOptions({ lora_type: 'lora', dora_enabled: true }, 'anima-lora')
    expect(findCard(cards, 'dora').selected).toBe(true)
    expect(findCard(cards, 'lora').selected).toBe(false)
  })

  test('legacy string DoRA flags select the same canonical card', () => {
    const cards = adapterOptions({ lora_type: 'lora', use_dora: 'true' }, 'anima-lora')
    expect(findCard(cards, 'dora').selected).toBe(true)
    expect(findCard(cards, 'lora').selected).toBe(false)
  })

  test('network_module-only configs resolve to their corresponding entity family and selected card', () => {
    const cases = [
      { module: 'networks.lora_fa', expectedWinnerId: 'lora_fa', expectedFamily: 'lora-fa', flagKey: 'lora_fa_enabled' },
      { module: 'networks.vera', expectedWinnerId: 'vera', expectedFamily: 'vera', flagKey: 'vera_enabled' },
      { module: 'networks.tlora', expectedWinnerId: 'tlora', expectedFamily: 'tlora', flagKey: 'tlora_enabled' },
      { module: 'networks.flexrank_lora', expectedWinnerId: 'flexrank', expectedFamily: 'flexrank', flagKey: 'flexrank_lora_enabled' },
    ]

    for (const { module, expectedWinnerId, expectedFamily, flagKey } of cases) {
      const config = { network_module: module }
      const winner = resolveWinningAdapterEntity(config)
      expect(winner.id).toBe(expectedWinnerId)
      expect(winner.source).toBe('network_module')

      const cards = adapterOptions(config, 'sdxl-lora')
      const targetCard = findCard(cards, expectedFamily)
      expect(targetCard.selected).toBe(true)

      const normalized = normalizeAdapterEntityMutex({ ...config }) as Record<string, unknown>
      expect(normalized[flagKey]).toBe(true)
      expect(resolveWinningAdapterEntity(normalized).id).toBe(expectedWinnerId)
    }
  })

  test('selecting standard networks.lora does not misclassify as a variant', () => {
    const config = { network_module: 'networks.lora' }
    expect(resolveWinningAdapterEntity(config).id).toBe('lora')
    const cards = adapterOptions(config, 'sdxl-lora')
    expect(findCard(cards, 'lora').selected).toBe(true)
    expect(findCard(cards, 'lora-fa').selected).toBe(false)
  })

  test('selecting LoRA-FA/T-LoRA/VeRA/FlexRank card updates network_module and selected family correctly', () => {
    const initialConfig = { network_module: 'networks.lora' }
    const cards = adapterOptions(initialConfig, 'sdxl-lora')

    for (const family of ['lora-fa', 'vera', 'tlora', 'flexrank']) {
      const card = findCard(cards, family)
      const selectedDraft = normalizeAdapterEntityMutex({
        ...initialConfig,
        ...buildAdapterSelection(initialConfig, card),
      }) as Record<string, unknown>

      const updatedCards = adapterOptions(selectedDraft, 'sdxl-lora')
      expect(findCard(updatedCards, family).selected).toBe(true)
      expect(findCard(updatedCards, 'lora').selected).toBe(false)
    }
  })

  test('lycoris winner maps by lycoris_algo / the lora_type-driven algo', () => {
    // anima-lora drives LyCORIS through lora_type (no lycoris_algo field).
    const cards = adapterOptions({ lora_type: 'locon' }, 'anima-lora')
    expect(resolveWinningAdapterEntity({ lora_type: 'locon' }).id).toBe('lycoris')
    expect(findCard(cards, 'locon').selected).toBe(true)
    expect(findCard(cards, 'loha').selected).toBe(false)
    expect(findCard(cards, 'lora').selected).toBe(false)
  })

  test('module-driven LyCORIS selection wins over stale default-LoRA variants', () => {
    const config = {
      network_module: 'lycoris.kohya',
      lycoris_algo: 'glokr',
      rs_lora_enabled: true,
      lora_plus_enabled: true,
      use_dora: true,
    }
    const cards = adapterOptions(config, 'sdxl-lora')

    expect(resolveWinningAdapterEntity(config).id).toBe('lycoris')
    expect(findCard(cards, 'glokr').selected).toBe(true)
    expect(findCard(cards, 'rs-lora').selected).toBe(false)
    expect(findCard(cards, 'lora-plus').selected).toBe(false)

    const glokr = findCard(cards, 'glokr')
    const next = normalizeAdapterEntityMutex({
      ...config,
      ...buildAdapterSelection(config, glokr),
    }) as Record<string, unknown>
    expect(next.rs_lora_enabled).toBe(false)
    expect(next.lora_plus_enabled).toBe(false)
    expect(next.use_dora).toBe(false)
  })

  test('flag cards leave a LyCORIS network before selecting a default or entity variant', () => {
    const config = { network_module: 'lycoris.kohya', lycoris_algo: 'glokr' }
    const cards = adapterOptions(config, 'sdxl-lora')

    for (const family of ['lora-plus', 'rs-lora', 'krona']) {
      expect(findCard(cards, family).values.network_module).toBe('networks.lora')
    }
  })
})

describe('adapterModel backend-present', () => {
  test('backend present: families omitted by backend are unsupported even if in fallback (bug #4 regression)', () => {
    applyBackendConfigOptions({
      adapter_families: {
        lora: { supports_rank: true, supports_alpha: true },
        locon: { supports_rank: true },
      },
    })
    expect(new Set(Object.keys(getBackendAdapterFamilyCapabilities()))).toEqual(new Set(['lora', 'locon']))
    const cards = adapterOptions({}, 'sdxl-lora')
    expect(findCard(cards, 'lora').compatibility).toBe('available')
    expect(findCard(cards, 'locon').compatibility).toBe('available')
    // dora is in the local fallback but omitted by the backend -> authoritative unsupported.
    expect(findCard(cards, 'dora').compatibility).toBe('unsupported')
    expect(findCard(cards, 'vera').compatibility).toBe('unsupported')
    expect(findCard(cards, 'reslora').compatibility).toBe('unsupported')
  })

  test('backend present: families provided by backend are available even if unknown locally', () => {
    applyBackendConfigOptions({
      adapter_families: {
        lora: { supports_rank: true },
        vera: { supports_rank: false, supports_alpha: false },
      },
    })
    const cards = adapterOptions({}, 'sdxl-lora')
    // vera is not in the local fallback but is backend-provided -> available.
    expect(findCard(cards, 'vera').compatibility).toBe('available')
    expect(findCard(cards, 'lora').compatibility).toBe('available')
    expect(findCard(cards, 'locon').compatibility).toBe('unsupported')
  })
})

describe('adapterModel buildAdapterSelection contract', () => {
  test('returns enables + clears + identity values for the caller to merge through the mutex', () => {
    const cards = adapterOptions({ lora_type: 'lora' }, 'anima-lora')
    const lora = findCard(cards, 'lora')
    const values = buildAdapterSelection({ lora_type: 'lora', vera_enabled: true }, lora)
    expect(values).toMatchObject({
      lora_type: 'lora',
      vera_enabled: false,
      reslora_enabled: false,
      dora_enabled: false,
      use_dora: false,
      dora_wd: false,
    })
    const next = normalizeAdapterEntityMutex({ ...{ lora_type: 'vera', vera_enabled: true }, ...values }) as Record<string, unknown>
    expect(resolveWinningAdapterEntity(next).id).toBe('lora')
  })
})

describe('adapterModel field presence gating', () => {
  test('entity cards are only created when the type schema contains the flag field', () => {
    // concept-edit has lora_type (NATIVE_ADAPTER_TYPES) but no S_LORA_VARIANTS,
    // so no flag-only cards like reslora / dokr should appear.
    const cards = adapterOptions({}, 'concept-edit')
    const families = new Set(cards.map((c) => c.family))
    expect(families.has('lora')).toBe(true)
    expect(getFieldDefinition('reslora_enabled', 'concept-edit')).toBeUndefined()
    expect(families.has('reslora')).toBe(false)
    expect(families.has('dokr')).toBe(false)
  })
})
