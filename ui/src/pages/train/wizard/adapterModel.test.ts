// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0

// NOTE on ordering: getBackendAdapterFamilyCapabilities() is backed by
// module-level state in schemaCommon (no public reset).  These tests therefore
// run backend-absent / malformed cases BEFORE any test that installs a valid
// backend payload, and the backend-present suite installs its own payload at the
// start.  Do not reorder those blocks.

import {
  ALL_TRAINING_TYPES,
  TRAINING_TYPES,
  applyBackendConfigOptions,
  getAdapterFamilyCapabilities,
  getBackendAdapterFamilyCapabilities,
  getFieldDefinition,
} from '@/schema/schemaIndex.js'
import {
  doraModelFamilyKey,
  doraStackableFamiliesForType,
  doraSupportAuditedForType,
  normalizeAdapterEntityMutex,
  normalizeAdapterFamily as schemaNormalizeAdapterFamily,
  resolveAdapterFamily,
  resolveWinningAdapterEntity,
} from '@/schema/schemaCommon.js'
import {
  adapterCategoryForFamily,
  adapterOptions,
  adapterRestrictionNoticeKey,
  adapterTierForFamily,
  buildAdapterDeselection,
  buildAdapterSelection,
  doraToggleState,
  groupAdapterOptionsByCategory,
  normalizeAdapterFamily,
  type AdapterCategoryKey,
  type AdapterOption,
} from './adapterModel'
import { useLocaleStore } from '@/stores/localeStore'

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

  test('DoRA is not a method card; its alias keys belong to the dora rider', () => {
    // DoRA is a weight-decomposition rider on the chosen algorithm, not a
    // competing family: no card offers it and none claims its aliases.
    const cards = adapterOptions({}, 'sdxl-lora')
    expect(cards.some((card) => card.family === 'dora')).toBe(false)
    for (const card of cards) {
      expect(card.hides).not.toContain('dora_wd')
      expect(card.hides).not.toContain('use_dora')
    }
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

  test('disabled option reasons follow UI language via the disabledReason_en channel', () => {
    // 评审修复：可见的 disabled 选项在 EN 下不再裸露中文理由。
    const original = useLocaleStore.getState().language
    try {
      useLocaleStore.getState().setLanguage('zh')
      const zhCard = findCard(adapterOptions({}, 'flux-lora'), 'diag-oft')
      expect(zhCard.disabledReason).toContain('暂未接入')
      expect(zhCard.description).toContain('暂未接入')

      useLocaleStore.getState().setLanguage('en')
      const enCards = adapterOptions({}, 'flux-lora')
      const enDiagOft = findCard(enCards, 'diag-oft')
      expect(enDiagOft.disabledReason).toBe('FLUX OFT is not wired into the backend trainer yet')
      expect(enDiagOft.description).toBe(enDiagOft.disabledReason)
    } finally {
      useLocaleStore.getState().setLanguage(original)
    }
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

  test('dora flag keeps the standard LoRA card selected and reports an enabled rider', () => {
    const config = { lora_type: 'lora', dora_enabled: true }
    const cards = adapterOptions(config, 'anima-lora')
    expect(findCard(cards, 'lora').selected).toBe(true)
    const rider = doraToggleState(config, 'anima-lora')
    expect(rider.available).toBe(true)
    expect(rider.supported).toBe(true)
    expect(rider.enabled).toBe(true)
    expect(rider.masterKey).toBe('dora_enabled')
  })

  test('legacy string DoRA flags resolve to the same enabled rider on the LoRA card', () => {
    const config = { lora_type: 'lora', use_dora: 'true' }
    const cards = adapterOptions(config, 'anima-lora')
    expect(findCard(cards, 'lora').selected).toBe(true)
    const rider = doraToggleState(config, 'anima-lora')
    expect(rider.enabled).toBe(true)
    expect(rider.supported).toBe(true)
    // legacy lora_type='dora' drafts resolve back to the standard LoRA card
    const legacyCards = adapterOptions({ lora_type: 'dora', dora_enabled: true }, 'anima-lora')
    expect(findCard(legacyCards, 'lora').selected).toBe(true)
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
    expect(cards.some((card) => card.family === 'dora')).toBe(false)
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

describe('adapterModel three-tier information architecture', () => {
  test('every card is classified as base, enhance, or entity', () => {
    for (const typeId of ['sdxl-lora', 'anima-lora', 'flux-lora']) {
      for (const card of adapterOptions({}, typeId)) {
        expect(['base', 'enhance', 'entity']).toContain(card.tier)
        expect(card.tier).toBe(adapterTierForFamily(card.family))
      }
    }
  })

  test('card labels/descriptions resolve per UI language (zh default, en via FAMILY_* bilingual maps)', () => {
    const original = useLocaleStore.getState().language
    try {
      useLocaleStore.getState().setLanguage('en')
      const lora = findCard(adapterOptions({}, 'anima-lora'), 'lora')
      expect(lora.label).toBe('Standard LoRA')
      expect(lora.description).toBe('Best compatibility; fits most base training.')
      // anima lora_type 的 gdlokr option 走 schemaFieldOptionsEn pack。
      const gdlokr = findCard(adapterOptions({}, 'anima-lora'), 'gdlokr')
      expect(gdlokr.label).toBe('GDLoKr (injected via the gdlokr_enabled entity flag)')

      useLocaleStore.getState().setLanguage('zh')
      const zhLora = findCard(adapterOptions({}, 'anima-lora'), 'lora')
      expect(zhLora.label).toBe('标准 LoRA')
      expect(zhLora.description).toBe('兼容性最好，适合大多数基础训练。')
    } finally {
      useLocaleStore.getState().setLanguage(original)
    }
  })

  test('rsLoRA / LoRA+ are enhancements; the 14 hard-mutex entities are injectors; base algos stay base', () => {
    expect(adapterTierForFamily('rs-lora')).toBe('enhance')
    expect(adapterTierForFamily('lora-plus')).toBe('enhance')
    for (const family of ['vera', 'tlora', 'flexrank', 'hydralora', 'fera', 'lora-fa', 'reslora', 'lora2', 'tensorring', 'dokr', 'gdlokr', 'cdka', 'krona', 'lora2-adaptive']) {
      expect(adapterTierForFamily(family), family).toBe('entity')
    }
    for (const family of ['lora', 'locon', 'loha', 'lokr', 'glora', 'glokr', 'ia3', 'full', 'diag-oft']) {
      expect(adapterTierForFamily(family), family).toBe('base')
    }
  })

  test('the method select only offers base-tier cards; entities and enhancers live in their own tiers', () => {
    const cards = adapterOptions({}, 'anima-lora')
    const baseFamilies = new Set(cards.filter((c) => c.tier === 'base').map((c) => c.family))
    expect(baseFamilies.has('lora')).toBe(true)
    expect(baseFamilies.has('locon')).toBe(true)
    // VeRA 等实体注入器不再作为基础算法方法出现
    expect(baseFamilies.has('vera')).toBe(false)
    expect(cards.find((c) => c.family === 'vera')?.tier).toBe('entity')
    expect(cards.find((c) => c.family === 'rs-lora')?.tier).toBe('enhance')
  })

  test('switching an entity toggle off falls back to the standard LoRA identity and clears the flag', () => {
    const config = { network_module: 'networks.vera', vera_enabled: true, dora_mode: 'wd' }
    const vera = findCard(adapterOptions(config, 'sdxl-lora'), 'vera')
    const values = buildAdapterDeselection('sdxl-lora', vera)
    const next = normalizeAdapterEntityMutex({ ...config, ...values }) as Record<string, unknown>
    expect(next.vera_enabled).toBe(false)
    expect(next.network_module).toBe('networks.lora')
    expect(resolveWinningAdapterEntity(next).id).toBe('lora')
  })

  test('base cards have no deselection path (they are chosen, not toggled)', () => {
    const lora = findCard(adapterOptions({}, 'sdxl-lora'), 'lora')
    expect(buildAdapterDeselection('sdxl-lora', lora)).toEqual({})
  })

  test('type-specific backend restrictions surface an explicit notice key', () => {
    expect(adapterRestrictionNoticeKey('flux-lora')).toBe('wizard.adapter.restrict.flux_native_lora')
    expect(adapterRestrictionNoticeKey('flux2-lora')).toBe('wizard.adapter.restrict.flux_native_lora')
    expect(adapterRestrictionNoticeKey('minimax-h3-lora')).toBe('wizard.adapter.restrict.minimax_native_only')
    expect(adapterRestrictionNoticeKey('minimax-h3-finetune')).toBe('wizard.adapter.restrict.minimax_native_only')
    expect(adapterRestrictionNoticeKey('anima-lora')).toBe('wizard.adapter.restrict.anima_alias_selector')
    expect(adapterRestrictionNoticeKey('sdxl-lora')).toBeNull()
    expect(adapterRestrictionNoticeKey('yolo')).toBeNull()
  })
})

describe('adapterModel unified family resolution (base-algorithm semantics)', () => {
  test('a DoRA-enabled draft resolves to its host family, never a standalone dora family', () => {
    // 后端 NetworkType.DORA 只是 networks.lora 的枚举别名（configs_enums.py:35-42）；
    // UI 家族语义必须与向导选中态一致：DoRA 归入宿主基础算法。
    expect(resolveAdapterFamily({ dora_enabled: true })).toBe('lora')
    expect(resolveAdapterFamily({ use_dora: true })).toBe('lora')
    expect(resolveAdapterFamily({ dora_wd: true })).toBe('lora')
    expect(resolveAdapterFamily({ rs_lora_enabled: true, dora_enabled: true })).toBe('rs-lora')
  })

  test('expert capability predicates share the same resolution as the wizard winner', () => {
    // anima 通过 lora_type 选择 LyCORIS：能力显隐此前解析成 lora（错误），
    // 统一后按基础算法 ia3 解析——ia3 不支持 rank/alpha。
    const config = { lora_type: 'ia3' }
    expect(resolveAdapterFamily(config)).toBe('ia3')
    const caps = getAdapterFamilyCapabilities().ia3
    expect(caps.supports_rank).toBe(false)
  })

  test('module-driven entities resolve through the same path as winnerFamily consumers', () => {
    expect(resolveAdapterFamily({ network_module: 'networks.vera' })).toBe('vera')
    expect(resolveAdapterFamily({ network_module: 'networks.lora_fa' })).toBe('lora-fa')
    expect(resolveAdapterFamily({ network_module: 'lycoris.kohya', lycoris_algo: 'glokr' })).toBe('glokr')
    expect(resolveAdapterFamily({ network_module: 'networks.oft' })).toBe('diag-oft')
    expect(resolveAdapterFamily({})).toBe('lora')
  })
})

describe('adapterModel doraToggleState (weight-decomposition rider)', () => {
  test('native networks.lora route rides via dora_enabled and is stackable', () => {
    const rider = doraToggleState({ network_module: 'networks.lora' }, 'sdxl-lora')
    expect(rider.available).toBe(true)
    expect(rider.supported).toBe(true)
    expect(rider.enabled).toBe(false)
    // sdxl 行是能力矩阵中已实证的行（SDXL 管线排查站结论）。
    expect(rider.audited).toBe(true)
    expect(rider.masterKey).toBe('dora_enabled')
    expect(rider.managedKeys).toEqual(expect.arrayContaining(['dora_enabled', 'dora_wd']))
  })

  test('module-driven LyCORIS algos cannot stack DoRA (backend ignores use_dora there)', () => {
    // 后端注入链 LyCORIS 分支先于 use_dora 分派；LyCORIS 注入器无任何 DoRA 入口。
    for (const algo of ['lokr', 'loha', 'locon', 'glora', 'ia3']) {
      const rider = doraToggleState({ network_module: 'lycoris.kohya', lycoris_algo: algo }, 'sdxl-lora')
      expect(rider.available, algo).toBe(true)
      expect(rider.supported, algo).toBe(false)
      expect(rider.audited, algo).toBe(true)
    }
  })

  test('sd15 row is audited (station 5): same generic chain as SDXL, v-parameterization orthogonal', () => {
    // SD15 站结论：select_trainer_key（entry_train.py:217-243）无特判 → 默认
    // lulynx 注入链；dora_wd 归一化对所有 model_type 生效
    // （config_adapter.py:511-517，closure 测试 :343-360 断言的共享 normalizer）。
    // v_parameterization 只被 loss/时间步侧文件消费，与 DoRA 模块前向正交；
    // sd15 TE 目标真实存在，请求训练文本编码器时 DoRA 同时落 UNet+TE1。
    const native = doraToggleState({ network_module: 'networks.lora' }, 'sd-lora')
    expect(native.available).toBe(true)
    expect(native.supported).toBe(true)
    expect(native.audited).toBe(true)
    // sd-lora 页面与 flux 同款：只定义 dora_wd（netLora 默认，无 hideDoraWd、无
    // LoRA 结构变体区）→ master 回退到 dora_wd。
    expect(native.masterKey).toBe('dora_wd')
    expect(native.managedKeys).toEqual(['dora_wd'])
    expect(native.familyNoteI18nKey).toBeNull()
    const lokr = doraToggleState({ network_module: 'lycoris.kohya', lycoris_algo: 'lokr' }, 'sd-lora')
    expect(lokr.supported).toBe(false)
    expect(lokr.audited).toBe(true)
  })

  test('station-5 cached-DiT families are audited native-only; rider stays unrendered without dora keys', () => {
    // 第 5 站结论：krea2/zimage/boogu/flux2/wan22 共享 LulynxTrainer 注入链，
    // TE 目标列表恒为空 → DoRA 结构性只落 DiT；深度扩层仅限 full_finetune；
    // wan22 A14B 双塔注入排除 `_wan22_secondary`。
    // 第 6 站桶 D 项：zimage / wan22-ti2v(5B) / boogu-Base 在 adapter 区补了单一
    // dora_enabled rider（矩阵行本就是 stackable ['lora']）→ available=true；
    // krea2（待 frozen_delta×DoRA 冒烟）/ boogu-edit（ref-latents 双路待冒烟）/
    // flux2（klein σ 直通幅度量纲待签）/ wan22-t2v-a14b（单塔显存基线刚绿）暂缓，
    // adapter 区仍无 DoRA 键 → available=false；矩阵行转正只影响 validator 文案证据态。
    for (const typeId of ['zimage-lora', 'wan22-ti2v-lora', 'boogu-lora']) {
      const rider = doraToggleState({}, typeId)
      expect(rider.available, typeId).toBe(true)
      expect(rider.supported, typeId).toBe(true)
      expect(rider.audited, typeId).toBe(true)
      expect(rider.masterKey, typeId).toBe('dora_enabled')
      expect(rider.managedKeys, typeId).toEqual(['dora_enabled'])
      expect(rider.familyNoteI18nKey, typeId).toBe('wizard.adapter.dora_toggle_family_cached_dit')
    }
    for (const typeId of ['krea2-lora', 'boogu-edit-lora', 'flux2-lora', 'wan22-t2v-a14b-lora']) {
      const rider = doraToggleState({}, typeId)
      expect(rider.available, typeId).toBe(false)
      expect(doraSupportAuditedForType(typeId), typeId).toBe(true)
      expect(doraStackableFamiliesForType(typeId), typeId).toEqual(['lora'])
      // 家族提示已就位：未来补暴露 dora_wd 时 rider 直接带边界说明。
      expect(doraModelFamilyKey(typeId), typeId).not.toBe('')
    }
    // finetune 变体同样命中正确矩阵行（无适配器面，rider 不渲染）。
    for (const typeId of ['krea2-finetune', 'zimage-finetune', 'boogu-finetune', 'flux2-finetune', 'wan22-finetune']) {
      expect(doraSupportAuditedForType(typeId), typeId).toBe(true)
    }
  })

  test('universal-dit row is audited (station 5): probe smoke includes use_dora modules', () => {
    // universal-dit 无前端训练类型；行仅用于 raw JSON 草稿。probe 训练冒烟在
    // inject_exact 之后运行（inject mixin:317-345 强制 train_smoke_verified），
    // use_dora=True 时 injected_layers 里就是 LoRALinear(use_dora=True) —— 验证面
    // 天然覆盖 DoRA；导出/合并路径显式处理 .dora_scale/.dora_magnitude。
    expect(doraModelFamilyKey('universal-dit-lora')).toBe('universal-dit')
    expect(doraModelFamilyKey('universal_dit_lora')).toBe('universal-dit')
    expect(doraSupportAuditedForType('universal-dit-lora')).toBe(true)
    expect(doraStackableFamiliesForType('universal-dit-lora')).toEqual(['lora'])
  })

  test('hidden/unlaunchable types carry explicit empty-stackable rows (station 5)', () => {
    // lumina/qwen-image/hunyuan-dit 在后端 _UNSUPPORTED_SCHEMA_IDS 中
    // （training_route_catalog.py:82-91），concept-edit 无路由条目 → is_known=False，
    // 训练本身不可启动；lab-distiller/aesthetic-scorer 非 LulynxTrainer 进程边界且
    // schema 无适配器字段。stackable=[] 让 doraWdVisible 隐藏死 schema 上的开关。
    for (const typeId of ['lumina-lora', 'lumina-finetune', 'qwen-image-lora', 'hunyuan-dit-lora', 'hunyuan-image-lora', 'concept-edit']) {
      expect(doraSupportAuditedForType(typeId), typeId).toBe(true)
      expect(doraStackableFamiliesForType(typeId), typeId).toEqual([])
    }
    expect(doraModelFamilyKey('lumina-lora')).toBe('lumina')
    expect(doraModelFamilyKey('hunyuan-image-lora')).toBe('hunyuan-dit')
    expect(doraModelFamilyKey('lumina-finetune')).toBe('lumina')
    expect(doraModelFamilyKey('concept-edit')).toBe('concept-edit')
    expect(doraModelFamilyKey('concept-edit')).toBe('concept-edit')
    // 无适配器进程边界的两个可见类型同样有显式行。
    expect(doraSupportAuditedForType('lab-distiller')).toBe(true)
    expect(doraStackableFamiliesForType('lab-distiller')).toEqual([])
    expect(doraSupportAuditedForType('aesthetic-scorer')).toBe(true)
    expect(doraStackableFamiliesForType('aesthetic-scorer')).toEqual([])
  })

  test('newbie row is audited (station 3): adapter_type remap keeps rider semantics native-only', () => {
    // NEWBIE 站结论：无专属训练器（entry_train.py select_trainer_key 走默认
    // lulynx 分派），与 SDXL/ANIMA 同一注入链；adapter_type 二次映射
    // （inject mixin:150-183）不改变 dora_enabled/use_dora/dora_wd 的主键语义，
    // 仅当映射把输入变成 LyCORIS/实体赢家时 DoRA 才被短路。TE 注入按缓存条件
    // 跳过（inject mixin:300，非 Anima 式强制）→ 家族边界通过 familyNote 暴露。
    const native = doraToggleState({ adapter_type: 'lora', dora_enabled: true }, 'newbie-lora')
    expect(native.available).toBe(true)
    expect(native.supported).toBe(true)
    expect(native.enabled).toBe(true)
    expect(native.audited).toBe(true)
    expect(native.masterKey).toBe('dora_enabled')
    expect(native.familyNoteI18nKey).toBe('wizard.adapter.dora_toggle_family_newbie')
    // LyCORIS 六算法（newbie 二次映射实际接收的集合）不可叠加。
    for (const algo of ['lokr', 'loha', 'locon', 'ia3', 'full', 'diag-oft']) {
      const rider = doraToggleState({ adapter_type: algo }, 'newbie-lora')
      expect(rider.supported, algo).toBe(false)
      expect(rider.audited, algo).toBe(true)
    }
    // glora/glokr 在 newbie 下拉中已禁用（后端静默降级为普通 LoRA）；
    // 旧草稿回显时同样不得给出可叠加承诺。
    for (const algo of ['glora', 'glokr']) {
      const rider = doraToggleState({ adapter_type: algo }, 'newbie-lora')
      expect(rider.supported, algo).toBe(false)
      expect(rider.audited, algo).toBe(true)
    }
    // 实体注入器赢家（如 vera_enabled）同样不可叠加。
    const vera = doraToggleState({ vera_enabled: true }, 'newbie-lora')
    expect(vera.supported).toBe(false)
    // few-step 契约页没有 DoRA 键 → 不渲染 rider。
    const fewStep = doraToggleState({}, 'newbie-few-step-lora')
    expect(fewStep.available).toBe(false)
  })

  test('anima row is audited (station 2): native-only stacking with pipeline-specific caveats', () => {
    // ANIMA 站结论：与 SDXL 共用 LulynxTrainer 注入链，LyCORIS 分支先于
    // use_dora 分派；cache-first 强制使 TE 恒无 DoRA，packed 显存优化器拒绝
    // DoRA 模块 —— 家族边界通过 familyNoteI18nKey 暴露。
    const native = doraToggleState({ lora_type: 'lora', dora_enabled: true }, 'anima-lora')
    expect(native.available).toBe(true)
    expect(native.supported).toBe(true)
    expect(native.enabled).toBe(true)
    expect(native.audited).toBe(true)
    expect(native.masterKey).toBe('dora_enabled')
    expect(native.familyNoteI18nKey).toBe('wizard.adapter.dora_toggle_family_anima')
    for (const algo of ['lokr', 'loha', 'locon', 'glora', 'glokr', 'ia3', 'full', 'diag-oft']) {
      const rider = doraToggleState({ lora_type: algo }, 'anima-lora')
      expect(rider.supported, algo).toBe(false)
      expect(rider.audited, algo).toBe(true)
    }
    // module 驱动的 LyCORIS 同样不可叠加（与 SDXL 相同的短路）。
    const moduleRider = doraToggleState({ network_module: 'lycoris.kohya', lycoris_algo: 'lokr' }, 'anima-lora')
    expect(moduleRider.supported).toBe(false)
    const finetune = doraToggleState({}, 'anima-finetune')
    expect(finetune.available).toBe(false)
  })

  test('unsupported algorithms disable the rider', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ lora_type: 'lokr' }, 'type-driven LyCORIS (anima-style)'],
      [{ vera_enabled: true }, 'entity winner'],
      [{ network_module: 'networks.oft' }, 'diag-oft module'],
    ]
    for (const [config, label] of cases) {
      const rider = doraToggleState(config, 'sdxl-lora')
      expect(rider.available, label).toBe(true)
      expect(rider.supported, label).toBe(false)
    }
  })

  test('types without any dora key render no rider at all', () => {
    const rider = doraToggleState({}, 'yolo')
    expect(rider.available).toBe(false)
    expect(rider.masterKey).toBeNull()
  })

  test('unavailable riders never report managed keys (defensive branch contract)', () => {
    // 评审修复：available:false 与非空 managedKeys 是误导组合——不渲染的开关
    // 不托管任何键。对所有注册类型（含仅定义 use_dora 的假想形态）统一成立。
    for (const type of ALL_TRAINING_TYPES) {
      const rider = doraToggleState({}, String(type.id))
      if (!rider.available) {
        expect(rider.managedKeys, String(type.id)).toEqual([])
      }
    }
  })

  test('flux-lora (dora_wd-only schema) still offers the native-LoRA rider', () => {
    const rider = doraToggleState({ network_module: 'networks.lora_flux' }, 'flux-lora')
    expect(rider.available).toBe(true)
    expect(rider.supported).toBe(true)
    // FLUX 站（第 4 站）实证：统一路由（默认）与 legacy FluxLoraTrainer 都只接受
    // networks.lora；dora_wd 经 ConfigAdapter 归一化（config_adapter.py:511-517）
    // 驱动两条路由，TE 恒冻结 → 行转正 audited:true 并带家族提示。
    expect(rider.audited).toBe(true)
    expect(rider.masterKey).toBe('dora_wd')
    expect(rider.managedKeys).toEqual(['dora_wd'])
    expect(rider.familyNoteI18nKey).toBe('wizard.adapter.dora_toggle_family_flux')
    // LyCORIS 在 flux 上是 fail-closed（inject mixin:118 RuntimeError），不是静默降级。
    const lycoris = doraToggleState({ network_module: 'lycoris.kohya', lycoris_algo: 'lokr' }, 'flux-lora')
    expect(lycoris.supported).toBe(false)
    expect(lycoris.audited).toBe(true)
  })

  test('ltx23/ltx25 rows are audited (station 4); no rider renders without dora keys', () => {
    // LTX 站结论：两类型共用 canonical ltx23 运行时族（contracts/training.py:176-179
    // 把 ltx25-lora 也映射为 ("ltx23","lora")），走通用注入链；TE 结构性不存在
    // （ltx23_loader.py 恒 text_encoder_1=None）。前端 adapter 区无任何 DoRA 键 →
    // rider 不渲染；矩阵行翻转只改变 validator 文案证据态。
    for (const typeId of ['ltx23-lora', 'ltx25-lora']) {
      const rider = doraToggleState({}, typeId)
      expect(rider.available, typeId).toBe(false)
      expect(rider.familyNoteI18nKey, typeId).toBeNull()
      expect(doraSupportAuditedForType(typeId), typeId).toBe(true)
      expect(doraStackableFamiliesForType(typeId), typeId).toEqual(['lora'])
    }
  })

  test('backend marking the host family supports_dora:false disables the rider', () => {
    applyBackendConfigOptions({
      adapter_families: {
        lora: { supports_rank: true, supports_alpha: true, supports_dora: false },
      },
    })
    const rider = doraToggleState({ network_module: 'networks.lora' }, 'sdxl-lora')
    expect(rider.available).toBe(true)
    expect(rider.supported).toBe(false)
  })

  test('matrix closure (station 5): every visible training type hits an explicit audited row', () => {
    // 五站收官全局一致性：可见训练类型经 doraModelFamilyKey 全部命中显式
    // 矩阵行（audited=true，无 pending 回退）。stackable 形态只有两种：['lora']
    // （仅原生 LoRA 可叠加）与 []（minimax-h3 硬拒 / 隐藏不可启动 / 无注入面进程
    // 边界）；未知键才落 DORA_SUPPORT_DEFAULT_ROW 防御行。
    // ALL_TRAINING_TYPES 是注册全表（含隐藏 legacy），可见面断言用 TRAINING_TYPES。
    // 2026-08 SDXL 桶补注册 sdxl-dreambooth/lllite/ip-adapter（均 sdxl 行）→ 39。
    // 收官审计补注册 universal-dit-lora（universal-dit 行，stackable=['lora']）→ 28。
    // webui-owned 解除隐藏：krea2/flux2/zimage/boogu/wan22 共 12 型后端已在
    // webui_owned_schemas.py 补注册 → 28 + 12 = 40。
    expect(TRAINING_TYPES).toHaveLength(40)
    for (const type of ALL_TRAINING_TYPES) {
      const typeId = String(type.id)
      expect(doraSupportAuditedForType(typeId), typeId).toBe(true)
      const stackable = doraStackableFamiliesForType(typeId)
      expect(
        [JSON.stringify(['lora']), JSON.stringify([])].includes(JSON.stringify(stackable)),
        `${typeId} → ${doraModelFamilyKey(typeId)} stackable=${JSON.stringify(stackable)}`,
      ).toBe(true)
      // 矩阵行存在性：family 键必须能查到行而不是落入默认 pending 行。
      expect(doraModelFamilyKey(typeId), typeId).not.toBe('')
    }
  })
})
