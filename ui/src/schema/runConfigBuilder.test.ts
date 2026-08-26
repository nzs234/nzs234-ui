// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * runConfigBuilder 行为回归门禁。
 *
 * 这里刻意用「合成 section」直接驱动 buildRunConfigFromSections，而不是只跑
 * parity snapshot：snapshot 只能证明「输出没变」，证明不了「输出是对的」。
 * 每个 describe 对应一条提交契约；断言写的是后端消费者要求的形态，
 * 而不是当前实现恰好产出的形状。
 *
 * 需要真实 schema 语义（字段可见性、默认值、类型分布）的用例另用
 * buildRunConfig(真 schema) 覆盖，见文件末尾的 "real schema" 分组。
 */

import { describe, expect, test } from 'vitest'
import { buildRunConfigFromSections } from './runConfigBuilder.js'
// schemaCommon.js 没有 .d.ts，allowJs 下推断出的是 string[]，这里就按 string[] 用。
import { SUPPORTED_LYCORIS_ALGOS } from './schemaCommon.js'
import { buildRunConfig, createDefaultConfig, getFieldDefinition, getSectionsForType, isFieldVisible } from './schemaIndex.js'

type Cfg = Record<string, unknown>
type FieldSpec = [key: string, type: string]

/** 合成一个单 section schema；visibleWhen 由 visible 参数统一控制。 */
function harness(fields: FieldSpec[], visible: (key: string) => boolean = () => true) {
  return {
    getSectionsForType: () => [
      {
        id: 'synthetic',
        tab: 'synthetic',
        title: 'synthetic',
        fields: fields.map(([key, type]) => ({ key, type })),
      },
    ],
    isFieldVisible: (field: { key: string }) => visible(field.key),
  }
}

function build(config: Cfg, typeId: string, fields: FieldSpec[], visible?: (key: string) => boolean): Cfg {
  // runConfigBuilder.js 没有 .d.ts，TS 从 JS 推断出的返回类型是残缺的
  // `{ model_train_type: any }`，不足以直接窄化成 Cfg，所以经 unknown 转一手。
  // 实际形态由本文件的断言负责验证。
  return buildRunConfigFromSections(config, typeId, harness(fields, visible)) as unknown as Cfg
}

/** 只保留感兴趣的键，避免被 normalize* 恒写入的全局键淹没断言。 */
function pick(payload: Cfg, keys: string[]): Cfg {
  const out: Cfg = {}
  for (const key of keys) if (key in payload) out[key] = payload[key]
  return out
}

// ─── collectVisiblePayload ────────────────────────────────────────────────────

describe('runConfigBuilder: payload collection', () => {
  test('model_train_type comes from the explicit typeId, then config, then sdxl-lora', () => {
    expect(build({}, 'anima-lora', [['a', 'string']]).model_train_type).toBe('anima-lora')
    // 显式 typeId 覆盖 config 里的残值(草稿可能带着旧类型)。
    expect(build({ model_train_type: 'stale-type' }, 'anima-lora', [['a', 'string']]).model_train_type)
      .toBe('anima-lora')
    expect(build({ model_train_type: 'anima-lora' }, '', [['a', 'string']]).model_train_type).toBe('anima-lora')
    expect(build({}, '', [['a', 'string']]).model_train_type).toBe('sdxl-lora')
  })

  test('invisible non-hidden fields are dropped; hidden fields always ship', () => {
    const payload = build(
      { shown: 'yes', gone: 'no', secret: 'always' },
      'x',
      [['shown', 'string'], ['gone', 'string'], ['secret', 'hidden']],
      (key) => key !== 'gone',
    )
    expect(payload.shown).toBe('yes')
    expect(payload).not.toHaveProperty('gone')
    // hidden 承载 model_train_type / turbocore_enabled 一类不可见但必须提交的键。
    expect(payload.secret).toBe('always')
  })

  test('ui_group placeholders never reach the payload', () => {
    const payload = build({ grp: 'decorative' }, 'x', [['grp', 'ui_group']])
    expect(payload).not.toHaveProperty('grp')
  })

  test('booleans are coerced, empty numbers dropped, numeric strings parsed', () => {
    const payload = build(
      { flag: 'truthy-string', off: 0, dim: '64', blank: '', nan: 'abc', ratio: 0.5 },
      'x',
      [['flag', 'boolean'], ['off', 'boolean'], ['dim', 'number'], ['blank', 'number'], ['nan', 'number'], ['ratio', 'slider']],
    )
    expect(payload.flag).toBe(true)
    expect(payload.off).toBe(false)
    expect(payload.dim).toBe(64)
    expect(payload).not.toHaveProperty('blank')
    // 不可解析的数字既不能提交 NaN，也不能提交原始字符串。
    expect(payload).not.toHaveProperty('nan')
    expect(payload.ratio).toBe(0.5)
  })

  test('dropout/network_dropout = 0 are omitted so the backend keeps its own default', () => {
    const zero = build({ dropout: 0, network_dropout: 0, other: 0 }, 'x', [
      ['dropout', 'number'], ['network_dropout', 'number'], ['other', 'number'],
    ])
    expect(zero).not.toHaveProperty('dropout')
    expect(zero).not.toHaveProperty('network_dropout')
    // 只有这两个键有 0=未设置语义；其它 0 是真实值。
    expect(zero.other).toBe(0)
  })

  test('learning-rate keys are numeric even when the draft holds scientific-notation strings', () => {
    // control_net_lr 已按幻影键治理从 payload 剥除（后端零读者），不再参与本断言。
    const payload = build(
      { learning_rate: '1e-4', unet_lr: '5e-5', text_encoder_lr: '0' },
      'x',
      [['learning_rate', 'string'], ['unet_lr', 'string'], ['text_encoder_lr', 'string']],
    )
    expect(payload.learning_rate).toBe(0.0001)
    expect(payload.unet_lr).toBe(0.00005)
    expect(payload.text_encoder_lr).toBe(0)
  })

  test('empty strings and null are dropped for non-numeric fields', () => {
    const payload = build({ a: '', b: null, c: undefined, d: 'keep' }, 'x', [
      ['a', 'string'], ['b', 'string'], ['c', 'string'], ['d', 'string'],
    ])
    expect(payload).not.toHaveProperty('a')
    expect(payload).not.toHaveProperty('b')
    expect(payload).not.toHaveProperty('c')
    expect(payload.d).toBe('keep')
  })
})

// ─── scheduler ───────────────────────────────────────────────────────────────

describe('runConfigBuilder: scheduler normalization', () => {
  const schedFields: FieldSpec[] = [['lr_scheduler', 'string'], ['lr_scheduler_args', 'string']]

  test('standard schedulers pass through untouched and never gain lr_scheduler_type', () => {
    for (const value of ['linear', 'cosine', 'cosine_with_restarts', 'constant', 'adafactor', 'piecewise_constant']) {
      const payload = build({ lr_scheduler: value }, 'x', schedFields)
      expect(payload.lr_scheduler).toBe(value)
      expect(payload).not.toHaveProperty('lr_scheduler_type')
    }
  })

  test('aliased schedulers map to the backend class and pin lr_scheduler=constant', () => {
    const cases: Array<[string, string]> = [
      ['cosine_annealing', 'torch.optim.lr_scheduler.CosineAnnealingLR'],
      ['cosine_annealing_with_warmup', 'pytorch_optimizer.CosineAnnealingWarmupRestarts'],
      ['cosine_annealing_warm_restarts', 'torch.optim.lr_scheduler.CosineAnnealingWarmRestarts'],
      ['rex', 'pytorch_optimizer.REXScheduler'],
    ]
    for (const [uiValue, backendType] of cases) {
      const payload = build({ lr_scheduler: uiValue }, 'x', schedFields)
      expect(payload.lr_scheduler_type, uiValue).toBe(backendType)
      // constant 是"交给 lr_scheduler_type 接管"的哨兵值，不是用户选择。
      expect(payload.lr_scheduler, uiValue).toBe('constant')
    }
  })

  test('fully-qualified class names are forwarded verbatim as lr_scheduler_type', () => {
    const payload = build({ lr_scheduler: 'torch.optim.lr_scheduler.OneCycleLR' }, 'x', schedFields)
    expect(payload.lr_scheduler_type).toBe('torch.optim.lr_scheduler.OneCycleLR')
    expect(payload.lr_scheduler).toBe('constant')
  })

  test('unknown non-standard schedulers still route through lr_scheduler_type', () => {
    // 后端负责报错，UI 不能静默吞掉用户输入或兜回 cosine。
    const payload = build({ lr_scheduler: 'my_custom_sched' }, 'x', schedFields)
    expect(payload.lr_scheduler_type).toBe('my_custom_sched')
    expect(payload.lr_scheduler).toBe('constant')
  })

  test('lr_scheduler_args textarea becomes a k=v list; blank input drops the key', () => {
    const payload = build({ lr_scheduler_args: 'T_max=10\n  eta_min=0  \nnot-a-pair\n' }, 'x', schedFields)
    expect(payload.lr_scheduler_args).toEqual(['T_max=10', 'eta_min=0'])
    expect(build({ lr_scheduler_args: '   ' }, 'x', schedFields)).not.toHaveProperty('lr_scheduler_args')
  })

  test('blank lr_scheduler_type is purged rather than submitted as an empty string', () => {
    const payload = build({ lr_scheduler_type: '   ' }, 'x', [['lr_scheduler_type', 'string']])
    expect(payload).not.toHaveProperty('lr_scheduler_type')
  })
})

// ─── optimizer args ──────────────────────────────────────────────────────────

describe('runConfigBuilder: optimizer args assembly', () => {
  const optFields: FieldSpec[] = [
    ['optimizer_type', 'string'],
    ['optimizer_args_custom', 'string'],
    ['prodigy_d0', 'string'],
    ['prodigy_d_coef', 'string'],
  ]

  test('UI-only optimizer scratch keys never reach the payload', () => {
    const payload = build(
      { optimizer_type: 'Prodigy', prodigy_d0: '1e-6', prodigy_d_coef: '1.5', optimizer_args_custom: 'x=1' },
      'x',
      optFields,
    )
    for (const key of ['prodigy_d0', 'prodigy_d_coef', 'optimizer_args_custom']) {
      expect(payload, key).not.toHaveProperty(key)
    }
  })

  test('Prodigy gets decouple/weight_decay/bias-correction plus d_coef and d0', () => {
    const payload = build({ optimizer_type: 'Prodigy', prodigy_d_coef: '1.5', prodigy_d0: '1e-6' }, 'x', optFields)
    expect(payload.optimizer_args).toEqual([
      'decouple=True',
      'weight_decay=0.01',
      'use_bias_correction=True',
      'd_coef=1.5',
      'd0=1e-6',
    ])
  })

  test('ProdigyPlus schedule-free omits decouple/weight_decay and defaults d_coef=2.0', () => {
    const payload = build({ optimizer_type: 'ProdigyPlus.ProdigyPlusScheduleFree' }, 'x', optFields)
    // schedule-free 变体自己管 decoupling；再塞 decouple=True 会被后端拒绝。
    expect(payload.optimizer_args).toEqual(['use_bias_correction=True', 'd_coef=2.0'])
  })

  test('prodigy d_coef/d0 of "0" or blank are treated as unset', () => {
    const payload = build({ optimizer_type: 'Prodigy', prodigy_d_coef: '0', prodigy_d0: '0' }, 'x', optFields)
    expect(payload.optimizer_args).toEqual(['decouple=True', 'weight_decay=0.01', 'use_bias_correction=True'])
  })

  test('custom args override auto args in place instead of appending a duplicate key', () => {
    const payload = build(
      { optimizer_type: 'Prodigy', prodigy_d_coef: '2.0', optimizer_args_custom: 'weight_decay=0.05\nextra=1' },
      'x',
      optFields,
    )
    const args = payload.optimizer_args as string[]
    expect(args.filter((line) => line.startsWith('weight_decay='))).toEqual(['weight_decay=0.05'])
    // 覆盖发生在原位置，追加项排在尾部。
    expect(args.indexOf('weight_decay=0.05')).toBe(1)
    expect(args.at(-1)).toBe('extra=1')
  })

  test('custom arg lines without "=" are ignored', () => {
    const payload = build(
      { optimizer_type: 'AdamW', optimizer_args_custom: 'garbage line\nweight_decay=0.02\n\n' },
      'x',
      optFields,
    )
    expect(payload.optimizer_args).toEqual(['weight_decay=0.02'])
  })

  test.each([
    ['PytorchOptimizer:Ranger21', 'PytorchOptimizer', 'Ranger21'],
    ['PytorchOptimizer/Ranger21', 'PytorchOptimizer', 'Ranger21'],
    ['pytorch_optimizer.Ranger21', 'PytorchOptimizer', 'Ranger21'],
  ])('%s collapses to %s with name=%s', (raw, expectedType, expectedName) => {
    const payload = build({ optimizer_type: raw }, 'x', optFields)
    expect(payload.optimizer_type).toBe(expectedType)
    expect(payload.optimizer_args).toEqual([`name=${expectedName}`])
  })

  test.each([
    ['GenericOptimizer:AdamW8bit', 'AdamW8bit'],
    ['bitsandbytes.optim.AdamW8bit', 'bitsandbytes.optim.AdamW8bit'],
  ])('%s collapses to GenericOptimizer with name=%s', (raw, expectedName) => {
    const payload = build({ optimizer_type: raw }, 'x', optFields)
    expect(payload.optimizer_type).toBe('GenericOptimizer')
    expect(payload.optimizer_args).toEqual([`name=${expectedName}`])
  })

  test('a user-supplied name= line is not duplicated by the plugin prefix', () => {
    const payload = build(
      { optimizer_type: 'PytorchOptimizer:Ranger21', optimizer_args_custom: 'name=Ranger\nbetas=0.9' },
      'x',
      optFields,
    )
    expect(payload.optimizer_args).toEqual(['name=Ranger', 'betas=0.9'])
  })

  test.each(['DAdaptation', 'DAdaptAdam', 'DAdaptLion'])('%s always sends decouple=True', (optimizer) => {
    expect(build({ optimizer_type: optimizer }, 'x', optFields).optimizer_args).toEqual(['decouple=True'])
  })

  test('opt_* fields map to backend arg names and are purged from the payload', () => {
    const payload = build(
      { optimizer_type: 'CAME', opt_came_eps_group: 1e-30, opt_came_eps_rho: 0.9999 },
      'x',
      [...optFields, ['opt_came_eps_group', 'number'], ['opt_came_eps_rho', 'number']],
    )
    expect(payload.optimizer_args).toEqual(['eps_group=1e-30', 'eps_rho=0.9999'])
    expect(Object.keys(payload).filter((key) => key.startsWith('opt_'))).toEqual([])
  })

  test('boolean opt_* flags serialize as their raw value, not as dropped falsy', () => {
    const payload = build(
      { optimizer_type: 'Adafactor', opt_adafactor_scale_parameter: false, opt_adafactor_relative_step: true },
      'x',
      [...optFields, ['opt_adafactor_scale_parameter', 'boolean'], ['opt_adafactor_relative_step', 'boolean']],
    )
    expect(payload.optimizer_args).toEqual(['scale_parameter=false', 'relative_step=true'])
  })

  test('no optimizer_args key at all when nothing was configured', () => {
    // 空数组会覆盖后端默认 args；必须整键缺席。
    expect(build({ optimizer_type: 'AdamW' }, 'x', optFields)).not.toHaveProperty('optimizer_args')
  })
})

// ─── LyCORIS network args ────────────────────────────────────────────────────

describe('runConfigBuilder: LyCORIS network args', () => {
  const lycoFields: FieldSpec[] = [
    ['network_module', 'string'],
    ['lycoris_algo', 'string'],
    ['conv_dim', 'number'],
    ['conv_alpha', 'number'],
    ['lycoris_preset', 'string'],
    ['dropout', 'number'],
    ['rank_dropout', 'number'],
    ['module_dropout', 'number'],
    ['train_norm', 'boolean'],
    ['use_tucker', 'boolean'],
    ['use_scalar', 'boolean'],
    ['block_size', 'number'],
    ['rescaled', 'boolean'],
    ['constraint', 'number'],
    ['rs_lora', 'boolean'],
    ['lokr_factor', 'number'],
    ['decompose_both', 'boolean'],
    ['full_matrix', 'boolean'],
    ['unbalanced_factorization', 'boolean'],
    ['dora_wd', 'boolean'],
    ['wd_on_output', 'boolean'],
    ['bypass_mode', 'boolean'],
    ['scale_weight_norms', 'number'],
    ['network_args_custom', 'string'],
  ]

  test.each(['lycoris.kohya', 'lycoris.locon', 'lycoris'])('%s normalizes network_module to lycoris.kohya', (module) => {
    const payload = build({ network_module: module, lycoris_algo: 'locon' }, 'sdxl-lora', lycoFields)
    expect(payload.network_module).toBe('lycoris.kohya')
  })

  test.each(['networks.oft', 'oft', 'diag-oft', 'diag_oft'])('%s becomes lycoris.kohya + algo=diag-oft', (module) => {
    const payload = build({ network_module: module }, 'sdxl-lora', lycoFields)
    expect(payload.network_module).toBe('lycoris.kohya')
    expect(payload.lycoris_algo).toBe('diag-oft')
    expect(payload.network_args).toContain('algo=diag-oft')
  })

  test.each(SUPPORTED_LYCORIS_ALGOS as string[])('supported algo %s survives normalization', (algo) => {
    // 单一来源检查：UI 白名单里的每个算法都不能被静默兜回 locon。
    const payload = build({ network_module: 'lycoris.kohya', lycoris_algo: algo }, 'sdxl-lora', lycoFields)
    expect(payload.lycoris_algo).toBe(algo)
    expect(payload.network_args).toContain(`algo=${algo}`)
  })

  test('algo casing and underscores are normalized; unknown algos fall back to locon', () => {
    expect(build({ network_module: 'lycoris.kohya', lycoris_algo: 'DIAG_OFT' }, 'sdxl-lora', lycoFields).lycoris_algo)
      .toBe('diag-oft')
    expect(build({ network_module: 'lycoris.kohya', lycoris_algo: 'not-real' }, 'sdxl-lora', lycoFields).lycoris_algo)
      .toBe('locon')
  })

  test('conv/dropout/norm settings are mirrored to lycoris_* keys and emitted as network_args', () => {
    const payload = build(
      {
        network_module: 'lycoris.kohya',
        lycoris_algo: 'locon',
        conv_dim: 8,
        conv_alpha: 4,
        lycoris_preset: '  attn-mlp  ',
        dropout: 0.1,
        rank_dropout: 0.2,
        module_dropout: 0.3,
        train_norm: true,
      },
      'sdxl-lora',
      lycoFields,
    )
    // train_norm=False 恒在尾部：它是 boolean schema 字段,collectVisiblePayload 会把
    // 未设置的值坍缩成 false,normalizeLycorisNetworkArgs 对 != null 一律显式下发。
    expect(payload.network_args).toEqual([
      'algo=locon',
      'conv_dim=8',
      'conv_alpha=4',
      'preset=attn-mlp',
      'dropout=0.1',
      'rank_dropout=0.2',
      'module_dropout=0.3',
      'train_norm=True',
    ])
    expect(pick(payload, ['lycoris_conv_dim', 'lycoris_conv_alpha', 'network_dropout', 'lokr_rank_dropout', 'lokr_module_dropout', 'lycoris_train_norm']))
      .toEqual({
        lycoris_conv_dim: 8,
        lycoris_conv_alpha: 4,
        network_dropout: 0.1,
        lokr_rank_dropout: 0.2,
        lokr_module_dropout: 0.3,
        lycoris_train_norm: true,
      })
  })

  test('train_norm=false is emitted explicitly (absence would mean "backend default")', () => {
    const payload = build({ network_module: 'lycoris.kohya', lycoris_algo: 'locon', train_norm: false }, 'sdxl-lora', lycoFields)
    expect(payload.network_args).toContain('train_norm=False')
    expect(payload.lycoris_train_norm).toBe(false)
  })

  test('lokr-only args are gated on algo=lokr', () => {
    const lokr = build(
      { network_module: 'lycoris.kohya', lycoris_algo: 'lokr', lokr_factor: 8, decompose_both: true, full_matrix: true, unbalanced_factorization: true },
      'sdxl-lora',
      lycoFields,
    )
    expect(lokr.network_args).toEqual(expect.arrayContaining([
      'factor=8', 'decompose_both=True', 'full_matrix=True', 'unbalanced_factorization=True',
    ]))
    expect(pick(lokr, ['lycoris_lokr_factor', 'lokr_decompose_both', 'lokr_full_matrix', 'lokr_unbalanced_factorization']))
      .toEqual({
        lycoris_lokr_factor: 8,
        lokr_decompose_both: true,
        lokr_full_matrix: true,
        lokr_unbalanced_factorization: true,
      })

    const loha = build(
      { network_module: 'lycoris.kohya', lycoris_algo: 'loha', lokr_factor: 8, decompose_both: true, full_matrix: true, unbalanced_factorization: true },
      'sdxl-lora',
      lycoFields,
    )
    const args = loha.network_args as string[]
    for (const forbidden of ['factor=8', 'decompose_both=True', 'full_matrix=True', 'unbalanced_factorization=True']) {
      expect(args, forbidden).not.toContain(forbidden)
    }
  })

  test('dora_wd/wd_on_output/bypass_mode are dropped on the LyCORIS route (backend ignores them there)', () => {
    // 后端注入链 LyCORIS 分支先于 use_dora 分派，network_args 又只解析
    // rs_lora/train_llm_adapter —— 这些键在 LyCORIS 路线是零接收者的惰性输出。
    const payload = build(
      { network_module: 'lycoris.kohya', lycoris_algo: 'locon', dora_wd: true, wd_on_output: true, bypass_mode: true },
      'sdxl-lora',
      lycoFields,
    )
    const args = payload.network_args as string[]
    for (const forbidden of ['dora_wd=True', 'wd_on_output=True', 'bypass_mode=False', 'bypass_mode=True']) {
      expect(args, forbidden).not.toContain(forbidden)
    }
    for (const key of ['dora_wd', 'wd_on_output', 'bypass_mode']) {
      expect(payload, key).not.toHaveProperty(key)
    }

    const ia3 = build(
      { network_module: 'lycoris.kohya', lycoris_algo: 'ia3', dora_wd: true, wd_on_output: true },
      'sdxl-lora',
      lycoFields,
    )
    expect((ia3.network_args as string[]).join(',')).not.toContain('dora_wd')
    expect(ia3).not.toHaveProperty('dora_wd')
  })

  test('native LoRA route keeps dora flags for the backend DoRA injector', () => {
    const payload = build({ network_module: 'networks.lora', dora_enabled: true }, 'x', [
      ['network_module', 'string'],
      ['dora_enabled', 'boolean'],
    ])
    expect(payload.dora_enabled).toBe(true)
    expect(payload.network_args).toBeUndefined()
  })

  test('bypass_mode is not synthesized into network_args at all', () => {
    const on = build({ network_module: 'lycoris.kohya', lycoris_algo: 'locon', bypass_mode: true }, 'sdxl-lora', lycoFields)
    expect(on.network_args).not.toContain('bypass_mode=True')
    const off = build({ network_module: 'lycoris.kohya', lycoris_algo: 'locon', bypass_mode: false }, 'sdxl-lora', lycoFields)
    expect(off.network_args).not.toContain('bypass_mode=False')
  })

  test('zero-valued dropouts and block_size are omitted from network_args', () => {
    const payload = build(
      { network_module: 'lycoris.kohya', lycoris_algo: 'locon', dropout: 0, rank_dropout: 0, module_dropout: 0, block_size: 0 },
      'sdxl-lora',
      lycoFields,
    )
    const args = payload.network_args as string[]
    for (const forbidden of ['dropout=0', 'rank_dropout=0', 'module_dropout=0', 'block_size=0']) {
      expect(args, forbidden).not.toContain(forbidden)
    }
    // train_norm 是 boolean schema 字段,恒被显式下发(见上一用例注释);
    // bypass_mode/dora_wd 等惰性键不再合成进 network_args。
    expect(args).toEqual(['algo=locon', 'train_norm=False'])
  })

  test('every LyCORIS UI-only key is purged after being folded into network_args', () => {
    const payload = build(
      {
        network_module: 'lycoris.kohya',
        lycoris_algo: 'lokr',
        conv_dim: 8, conv_alpha: 4, lycoris_preset: 'attn', dropout: 0.1, rank_dropout: 0.2,
        module_dropout: 0.3, train_norm: true, use_tucker: true, use_scalar: true, block_size: 4,
        rescaled: true, constraint: 1, rs_lora: true, lokr_factor: 8, dora_wd: true, wd_on_output: true,
        bypass_mode: true, decompose_both: true, full_matrix: true, unbalanced_factorization: true,
        network_args_custom: 'extra=1',
      },
      'sdxl-lora',
      lycoFields,
    )
    for (const key of [
      'conv_dim', 'conv_alpha', 'lycoris_preset', 'dropout', 'rank_dropout', 'module_dropout',
      'train_norm', 'use_tucker', 'use_scalar', 'block_size', 'rescaled', 'constraint', 'rs_lora',
      'lokr_factor', 'dora_wd', 'wd_on_output', 'bypass_mode', 'decompose_both', 'full_matrix',
      'unbalanced_factorization', 'enable_base_weight', 'network_args_custom',
    ]) {
      expect(payload, key).not.toHaveProperty(key)
    }
    // 自定义行始终排在自动生成 args 之后，保证用户覆盖生效。
    expect((payload.network_args as string[]).at(-1)).toBe('extra=1')
  })

  test('non-LyCORIS modules keep network_args_custom lines but never synthesize algo=', () => {
    const payload = build(
      { network_module: 'networks.lora', network_args_custom: 'foo=1\n\n bar=2 ' },
      'sdxl-lora',
      lycoFields,
    )
    expect(payload.network_args).toEqual(['foo=1', 'bar=2'])
    expect(payload).not.toHaveProperty('network_args_custom')
    expect(payload.network_module).toBe('networks.lora')
  })

  test('anima types skip LyCORIS arg synthesis even when the module says lycoris', () => {
    // Anima 自己的注入路径不吃 kohya 的 algo= 约定；这里必须原样透传用户行。
    const payload = build(
      { network_module: 'lycoris.kohya', lycoris_algo: 'lokr', conv_dim: 8, network_args_custom: 'algo=lokr\nfactor=4' },
      'anima-lora',
      lycoFields,
    )
    expect(payload.network_args).toEqual(['algo=lokr', 'factor=4'])
    expect(payload).not.toHaveProperty('network_args_custom')
  })

  test('no network_args key when there is nothing to send', () => {
    expect(build({ network_module: 'networks.lora' }, 'sdxl-lora', lycoFields)).not.toHaveProperty('network_args')
  })
})

// ─── attention ───────────────────────────────────────────────────────────────

describe('runConfigBuilder: attention backend resolution', () => {
  const attnFields: FieldSpec[] = [
    ['attention_backend', 'string'],
    ['attn_mode', 'string'],
    ['anima_attn_mode', 'string'],
    ['flashattn', 'boolean'],
    ['sageattn', 'boolean'],
    ['xformers', 'boolean'],
    ['sdpa', 'boolean'],
    ['use_sdpa', 'boolean'],
    ['mem_eff_attn', 'boolean'],
  ]

  const attn = (config: Cfg, typeId = 'sdxl-lora') => {
    const payload = build(config, typeId, attnFields)
    return pick(payload, ['attention_backend', 'flashattn', 'sageattn', 'xformers', 'sdpa', 'attn_mode', 'anima_attn_mode'])
  }

  test('no intent at all resolves to auto with every toggle off', () => {
    // auto 是"让 launcher runtime 决定"；不能被 UI 提前钉死成 sdpa。
    expect(attn({})).toMatchObject({ attention_backend: 'auto', flashattn: false, sageattn: false, xformers: false, sdpa: false })
  })

  test('a bare schema-default sdpa=true is not treated as user intent', () => {
    expect(attn({ sdpa: true })).toMatchObject({ attention_backend: 'auto', sdpa: false })
  })

  test('explicit use_sdpa is intent and pins backend=sdpa', () => {
    expect(attn({ use_sdpa: true })).toMatchObject({ attention_backend: 'sdpa' })
  })

  test.each([
    ['flashattn', 'flash2'],
    ['sageattn', 'sageattn'],
    ['xformers', 'xformers'],
  ])('advanced toggle %s selects backend %s', (toggle, backend) => {
    expect(attn({ [toggle]: true })).toMatchObject({ attention_backend: backend })
  })

  test('mem_eff_attn is an xformers alias', () => {
    expect(attn({ mem_eff_attn: true })).toMatchObject({ attention_backend: 'xformers' })
  })

  test('flash2 wins over sage/xformers/sdpa when several toggles are on', () => {
    const resolved = attn({ flashattn: true, sageattn: true, xformers: true, use_sdpa: true })
    expect(resolved).toMatchObject({ attention_backend: 'flash2', flashattn: true })
    // 非赢家开关必须被清掉，否则后端会看到互相矛盾的意图。
    expect(resolved).toMatchObject({ sageattn: false, xformers: false, sdpa: false })
  })

  test('sage wins over xformers/sdpa', () => {
    expect(attn({ sageattn: true, xformers: true, use_sdpa: true }))
      .toMatchObject({ attention_backend: 'sageattn', sageattn: true, xformers: false, sdpa: false })
  })

  test.each([
    ['flash', 'flash2'], ['flashattn', 'flash2'], ['flashattention', 'flash2'], ['flashattention2', 'flash2'], ['fa2', 'flash2'],
    ['sage', 'sageattn'], ['sageattention', 'sageattn'],
    ['flex', 'flexattn'], ['flexattention', 'flexattn'],
  ])('attention_backend alias %s normalizes to %s', (raw, expected) => {
    expect(attn({ attention_backend: raw })).toMatchObject({ attention_backend: expected })
  })

  test('non-auto backend selections survive and clear conflicting toggles', () => {
    for (const backend of ['flash2', 'sageattn', 'xformers', 'sdpa', 'flexattn', 'torch']) {
      const resolved = attn({ attention_backend: backend })
      expect(resolved.attention_backend, backend).toBe(backend)
    }
    expect(attn({ attention_backend: 'flash2' })).toMatchObject({ flashattn: true, sageattn: false, xformers: false, sdpa: false })
    expect(attn({ attention_backend: 'sageattn' })).toMatchObject({ sageattn: true, flashattn: false })
    expect(attn({ attention_backend: 'torch' })).toMatchObject({ flashattn: false, sageattn: false, xformers: false, sdpa: false })
  })

  test('attn_mode / anima_attn_mode are honored as intent and synced to flash2', () => {
    const fromMode = attn({ attn_mode: 'flash' })
    expect(fromMode).toMatchObject({ attention_backend: 'flash2', attn_mode: 'flash2' })
    const fromAnima = attn({ anima_attn_mode: 'flashattention2' })
    expect(fromAnima).toMatchObject({ attention_backend: 'flash2', anima_attn_mode: 'flash2' })
  })

  test('sdpa-valued modes are rewritten to auto when nothing selected a backend', () => {
    // attn_mode='sdpa' 单独出现属于 schema 默认，不能钉死 backend。
    const payload = build({ attn_mode: 'sdpa', anima_attn_mode: 'sdpa' }, 'sdxl-lora', attnFields)
    expect(payload.attention_backend).toBe('sdpa')
    // 一旦 mode 明确写了 sdpa，它就是 intent；auto 分支只在无 intent 时改写 mode。
    const noIntent = build({ attn_mode: 'auto', anima_attn_mode: 'auto' }, 'sdxl-lora', attnFields)
    expect(noIntent.attention_backend).toBe('auto')
    expect(noIntent.attn_mode).toBe('auto')
  })

  test('xformers boolean is only re-asserted when the user actually set it', () => {
    // backend=xformers 但开关没开:不要凭空写 xformers=true(schema boolean 默认已是 false)。
    expect(attn({ attention_backend: 'xformers' }).xformers).toBe(false)
    expect(attn({ attention_backend: 'xformers', xformers: true })).toMatchObject({ xformers: true })
  })
})

// ─── Anima VRAM optimizer ────────────────────────────────────────────────────

describe('runConfigBuilder: Anima VRAM optimizer', () => {
  const vramFields: FieldSpec[] = [
    ['anima_vram_optimizer', 'boolean'],
    ['attention_backend', 'string'],
    ['attn_mode', 'string'],
    ['anima_attn_mode', 'string'],
    ['flashattn', 'boolean'],
  ]

  /** anima_vram_optimizer 声明为 string,以便驱动 _truthyFlag 而不是 boolean 预坍缩。 */
  const looseVramFields: FieldSpec[] = [
    ['anima_vram_optimizer', 'string'],
    ...vramFields.slice(1),
  ]

  const vram = (config: Cfg, typeId = 'anima-lora', fields: FieldSpec[] = vramFields) =>
    pick(build(config, typeId, fields), [
      'anima_vram_optimizer',
      'anima_packed_attention_backend',
      'anima_block_checkpointing',
      'anima_block_checkpointing_mode',
      'anima_block_checkpointing_interval',
      'attention_backend',
    ])

  test('off by default: packed attention pinned to dense', () => {
    expect(vram({})).toMatchObject({ anima_vram_optimizer: false, anima_packed_attention_backend: 'dense' })
  })

  test('flash2 + intent enables varlen packing and the cheapest checkpointing', () => {
    expect(vram({ anima_vram_optimizer: true, flashattn: true })).toEqual({
      anima_vram_optimizer: true,
      anima_packed_attention_backend: 'flash2_varlen',
      anima_block_checkpointing: true,
      anima_block_checkpointing_mode: 'block',
      anima_block_checkpointing_interval: 1,
      attention_backend: 'flash2',
    })
  })

  test('attention_backend=flash2 alone also satisfies the flash2 requirement', () => {
    expect(vram({ anima_vram_optimizer: true, attention_backend: 'flash2' }))
      .toMatchObject({ anima_vram_optimizer: true, anima_packed_attention_backend: 'flash2_varlen' })
  })

  test.each(['sageattn', 'xformers', 'sdpa', 'torch'])('non-flash2 backend %s force-disables the optimizer', (backend) => {
    const resolved = vram({ anima_vram_optimizer: true, attention_backend: backend })
    expect(resolved).toMatchObject({ anima_vram_optimizer: false, anima_packed_attention_backend: 'dense' })
    // 关掉时不得留下 checkpointing 副作用。
    expect(resolved).not.toHaveProperty('anima_block_checkpointing_mode')
  })

  test('string truthies from legacy drafts count as enabled intent', () => {
    // 老草稿可能把开关存成字符串;归一必须按语义而不是 JS truthiness 判断,
    // 否则 'false'/'off' 会被 Boolean() 判成开启。
    for (const truthy of ['true', 'True', '1', 'yes', 'on']) {
      expect(vram({ anima_vram_optimizer: truthy, flashattn: true }, 'anima-lora', looseVramFields).anima_vram_optimizer, truthy)
        .toBe(true)
    }
    for (const falsy of ['false', 'no', 'off', '0', '', 'garbage']) {
      expect(vram({ anima_vram_optimizer: falsy, flashattn: true }, 'anima-lora', looseVramFields).anima_vram_optimizer, falsy)
        .toBe(false)
    }
  })

  test('CONTRACT: auto backend keeps the request alive for the runtime guardrail to resolve', () => {
    // 目标契约(与 backend config_adapter_main_runtime_fields.normalize_runtime_fields 对齐):
    // attention_backend in {"", auto, default} 时后端保留 anima_vram_optimizer=True，
    // 交给 anima_dit_runtime_guardrails 用实际解析出的 backend 做最终判定。
    // 前端在 auto 下直接置 false，会让"开了却没生效"这件事在提交阶段就丢失意图。
    // 生产实现尚未修复 → 本用例目前失败，属于已知待合并项，不下调断言。
    expect(vram({ anima_vram_optimizer: true, attention_backend: 'auto' }))
      .toMatchObject({ anima_vram_optimizer: true })
  })

  test('CONTRACT: types without an attention_backend field can still request the optimizer', () => {
    // anima-lora / anima-edit-model 是唯一暴露 anima_vram_optimizer 的两个类型，
    // 但它们的 schema 里没有 attention_backend / attn_mode 字段，flashattn 又被
    // requiresAttentionBackend:'flash2' 挡在不可见状态 → 真实草稿永远拿不到 flash2 意图，
    // 该开关在真 schema 下恒被归一成 false。
    // 目标契约:无 backend 字段(即 auto)时保留意图，由后端/运行时决定。
    // 生产实现尚未修复 → 本用例目前失败。
    const draft = { ...(createDefaultConfig('anima-lora') as Cfg), anima_vram_optimizer: true }
    const payload = buildRunConfig(draft, 'anima-lora') as Cfg
    expect(payload.anima_vram_optimizer).toBe(true)
  })
})

// ─── layered alpha ───────────────────────────────────────────────────────────

describe('runConfigBuilder: layered alpha map', () => {
  const alphaFields: FieldSpec[] = [
    ['layered_alpha_enabled', 'boolean'],
    ['alpha_self_attn', 'number'],
    ['alpha_cross_attn', 'number'],
    ['alpha_mlp', 'number'],
    ['alpha_adaln', 'number'],
    ['alpha_llm_adapter', 'number'],
    ['network_alpha', 'number'],
  ]

  test('enabled groups are folded into network_alpha_map_json with backend group names', () => {
    const payload = build(
      { layered_alpha_enabled: true, alpha_self_attn: 32, alpha_cross_attn: 24, alpha_mlp: 16, alpha_adaln: 8, alpha_llm_adapter: 4 },
      'anima-lora',
      alphaFields,
    )
    expect(JSON.parse(String(payload.network_alpha_map_json))).toEqual({
      self_attn: 32,
      cross_attn: 24,
      mlp: 16,
      adaln_modulation: 8,
      llm_adapter: 4,
    })
  })

  test('only non-empty positive groups are recorded', () => {
    const payload = build(
      { layered_alpha_enabled: true, alpha_self_attn: 32, alpha_cross_attn: '', alpha_mlp: 0, alpha_adaln: -1 },
      'anima-lora',
      alphaFields,
    )
    expect(JSON.parse(String(payload.network_alpha_map_json))).toEqual({ self_attn: 32 })
  })

  test('the switch off drops the map so the backend uses the global network_alpha', () => {
    const payload = build({ layered_alpha_enabled: false, alpha_self_attn: 32, network_alpha: 16 }, 'anima-lora', alphaFields)
    expect(payload).not.toHaveProperty('network_alpha_map_json')
    expect(payload.network_alpha).toBe(16)
  })

  test('enabled with no group values also drops the map (parity with global alpha)', () => {
    const payload = build({ layered_alpha_enabled: true }, 'anima-lora', alphaFields)
    expect(payload).not.toHaveProperty('network_alpha_map_json')
  })

  test('the per-group UI keys and the switch never reach the payload', () => {
    const payload = build(
      { layered_alpha_enabled: true, alpha_self_attn: 32, alpha_cross_attn: 24, alpha_mlp: 16, alpha_adaln: 8, alpha_llm_adapter: 4 },
      'anima-lora',
      alphaFields,
    )
    for (const key of ['layered_alpha_enabled', 'alpha_self_attn', 'alpha_cross_attn', 'alpha_mlp', 'alpha_adaln', 'alpha_llm_adapter']) {
      expect(payload, key).not.toHaveProperty(key)
    }
  })

  test('types without grouped-alpha controls are left completely alone', () => {
    const payload = build({ network_alpha: 16 }, 'sdxl-lora', [['network_alpha', 'number']])
    expect(payload).not.toHaveProperty('network_alpha_map_json')
    expect(payload.network_alpha).toBe(16)
  })
})

// ─── UI-only field purge ─────────────────────────────────────────────────────

describe('runConfigBuilder: UI-only field purge', () => {
  test('block weights are dropped unless the enable switch is on; the switch itself never ships', () => {
    const fields: FieldSpec[] = [
      ['enable_block_weights', 'boolean'], ['down_lr_weight', 'string'], ['mid_lr_weight', 'string'],
      ['up_lr_weight', 'string'], ['block_lr_zero_threshold', 'number'],
    ]
    const on = build(
      { enable_block_weights: true, down_lr_weight: '1,1', mid_lr_weight: '1', up_lr_weight: '1,1', block_lr_zero_threshold: 0.1 },
      'sdxl-lora',
      fields,
    )
    expect(pick(on, ['down_lr_weight', 'mid_lr_weight', 'up_lr_weight', 'block_lr_zero_threshold']))
      .toEqual({ down_lr_weight: '1,1', mid_lr_weight: '1', up_lr_weight: '1,1', block_lr_zero_threshold: 0.1 })
    expect(on).not.toHaveProperty('enable_block_weights')

    const off = build(
      { enable_block_weights: false, down_lr_weight: '1,1', mid_lr_weight: '1', up_lr_weight: '1,1', block_lr_zero_threshold: 0.1 },
      'sdxl-lora',
      fields,
    )
    for (const key of ['down_lr_weight', 'mid_lr_weight', 'up_lr_weight', 'block_lr_zero_threshold', 'enable_block_weights']) {
      expect(off, key).not.toHaveProperty(key)
    }
  })

  test('base weights only ship when enabled, split per line, multipliers coerced to numbers', () => {
    const fields: FieldSpec[] = [
      ['enable_base_weight', 'boolean'], ['base_weights', 'string'], ['base_weights_multiplier', 'string'],
    ]
    const on = build(
      { enable_base_weight: true, base_weights: '/a.safetensors\n\n /b.safetensors ', base_weights_multiplier: '0.5\nbogus\n0.8' },
      'sdxl-lora',
      fields,
    )
    expect(on.base_weights).toEqual(['/a.safetensors', '/b.safetensors'])
    expect(on.base_weights_multiplier).toEqual([0.5, 0.8])
    expect(on).not.toHaveProperty('enable_base_weight')

    const off = build({ enable_base_weight: false, base_weights: '/a.safetensors', base_weights_multiplier: '0.5' }, 'sdxl-lora', fields)
    expect(off).not.toHaveProperty('base_weights')
    expect(off).not.toHaveProperty('base_weights_multiplier')
  })

  test.each(['train_length_mode', 'enable_inference_accel', 'ui_custom_params', 'wan22_tower_choice'])(
    'pure UI key %s is always stripped',
    (key) => {
      const payload = build({ [key]: 'anything' }, 'sdxl-lora', [[key, 'string']])
      expect(payload).not.toHaveProperty(key)
    },
  )

  test('legacy wan22_tower_choice migrates into wan22_noise_stage without clobbering it', () => {
    const migrated = build({ wan22_tower_choice: 'high' }, 'wan22-t2v-a14b-lora', [
      ['wan22_tower_choice', 'string'], ['wan22_noise_stage', 'string'],
    ])
    expect(migrated.wan22_noise_stage).toBe('high')

    const explicit = build({ wan22_tower_choice: 'high', wan22_noise_stage: 'low' }, 'wan22-t2v-a14b-lora', [
      ['wan22_tower_choice', 'string'], ['wan22_noise_stage', 'string'],
    ])
    expect(explicit.wan22_noise_stage).toBe('low')
  })

  test('ui_custom_params migrates into custom_toml only when custom_toml is empty', () => {
    const fields: FieldSpec[] = [['ui_custom_params', 'string'], ['custom_toml', 'string']]
    expect(build({ ui_custom_params: 'a=1' }, 'sdxl-lora', fields).custom_toml).toBe('a=1')
    expect(build({ ui_custom_params: 'a=1', custom_toml: 'b=2' }, 'sdxl-lora', fields).custom_toml).toBe('b=2')
    expect(build({ ui_custom_params: '   ' }, 'sdxl-lora', fields)).not.toHaveProperty('custom_toml')
  })

  test('huber_schedule empty string is dropped rather than sent as ""', () => {
    expect(build({ huber_schedule: '' }, 'sdxl-lora', [['huber_schedule', 'string']])).not.toHaveProperty('huber_schedule')
    expect(build({ huber_schedule: 'snr' }, 'sdxl-lora', [['huber_schedule', 'string']]).huber_schedule).toBe('snr')
  })

  test('newbie_target_modules newlines are normalized and blank input becomes undefined', () => {
    const fields: FieldSpec[] = [['newbie_target_modules', 'string']]
    expect(build({ newbie_target_modules: ' a\r\nb\rc ' }, 'newbie-lora', fields).newbie_target_modules).toBe('a\nb\nc')
    // 置 undefined 而非 delete;JSON.stringify 同样会把它丢掉,所以后端看不到空串。
    const blank = build({ newbie_target_modules: '  ' }, 'newbie-lora', fields)
    expect(blank.newbie_target_modules).toBeUndefined()
    expect(JSON.parse(JSON.stringify(blank))).not.toHaveProperty('newbie_target_modules')
  })
})

// ─── adapter init strategy ───────────────────────────────────────────────────

describe('runConfigBuilder: adapter init strategy purge', () => {
  const initFields: FieldSpec[] = [
    ['adapter_init_strategy', 'string'], ['adapter_init_export_mode', 'string'],
    ['pissa_init', 'boolean'], ['pissa_enabled', 'boolean'], ['pissa_method', 'string'],
    ['pissa_niter', 'number'], ['pissa_svd_algo', 'string'], ['pissa_init_iters', 'number'],
    ['pissa_export_mode', 'string'], ['pissa_oversample', 'number'], ['pissa_apply_conv2d', 'boolean'],
    ['pissa_cache_mode', 'string'], ['loftq_bits', 'number'], ['loftq_quant_type', 'string'],
  ]

  test('default strategy strips every init-specific key', () => {
    const payload = build(
      { adapter_init_strategy: 'default', pissa_method: 'rsvd', pissa_niter: 2, loftq_bits: 4, loftq_quant_type: 'rowwise', adapter_init_export_mode: 'auto' },
      'sdxl-lora',
      initFields,
    )
    for (const key of ['pissa_method', 'pissa_niter', 'pissa_svd_algo', 'pissa_export_mode', 'pissa_enabled', 'loftq_bits', 'loftq_quant_type', 'adapter_init_export_mode']) {
      expect(payload, key).not.toHaveProperty(key)
    }
  })

  test('pissa strategy sets the master flags and maps legacy UI keys to backend keys', () => {
    const payload = build(
      { adapter_init_strategy: 'pissa', pissa_method: 'rsvd', pissa_niter: 4, pissa_export_mode: 'lora_compatible' },
      'sdxl-lora',
      initFields,
    )
    expect(pick(payload, ['adapter_init_strategy', 'pissa_init', 'pissa_enabled', 'pissa_svd_algo', 'pissa_init_iters', 'pissa_export_mode']))
      .toEqual({
        adapter_init_strategy: 'pissa',
        pissa_init: true,
        pissa_enabled: true,
        pissa_svd_algo: 'rsvd',
        pissa_init_iters: 4,
        pissa_export_mode: 'lora_compatible',
      })
  })

  test('pissa_init / pissa_enabled alone are enough to select the pissa strategy', () => {
    expect(build({ pissa_init: true }, 'sdxl-lora', initFields).adapter_init_strategy).toBe('pissa')
    expect(build({ pissa_enabled: true }, 'sdxl-lora', initFields).adapter_init_strategy).toBe('pissa')
  })

  test('pissa export mode passes through as-is; Chinese-label mapping lives at the draft layer now', () => {
    // schema 选项已枚举化（anima/sdxl 一致），提交层不再保留第二份中文 label 映射；
    // 旧草稿值由 configStore.LEGACY_VALUE_MIGRATIONS 在草稿加载时迁移。
    expect(build({ adapter_init_strategy: 'pissa', pissa_export_mode: 'approximate' }, 'sdxl-lora', initFields).pissa_export_mode)
      .toBe('approximate')
    expect(build({ adapter_init_strategy: 'pissa', pissa_export_mode: 'raw' }, 'sdxl-lora', initFields).pissa_export_mode).toBe('raw')
  })

  test('loftq keeps its quant knobs; other non-default strategies drop them', () => {
    const loftq = build({ adapter_init_strategy: 'loftq', loftq_bits: 4, loftq_quant_type: 'rowwise' }, 'sdxl-lora', initFields)
    expect(pick(loftq, ['loftq_bits', 'loftq_quant_type'])).toEqual({ loftq_bits: 4, loftq_quant_type: 'rowwise' })

    const olora = build({ adapter_init_strategy: 'olora', loftq_bits: 4, loftq_quant_type: 'rowwise' }, 'sdxl-lora', initFields)
    expect(olora).not.toHaveProperty('loftq_bits')
    expect(olora).not.toHaveProperty('loftq_quant_type')
  })

  test('init_lora_weights is accepted as a legacy alias for the strategy', () => {
    const payload = build({ init_lora_weights: 'pissa' }, 'sdxl-lora', [...initFields, ['init_lora_weights', 'string']])
    expect(payload.adapter_init_strategy).toBe('pissa')
    expect(payload.pissa_init).toBe(true)
  })
})

// ─── theory variant aliases ──────────────────────────────────────────────────

describe('runConfigBuilder: theory variant aliases', () => {
  test.each([
    ['standard', 'p2'],
    ['structure', 'lulynx_structure'],
    ['detail', 'lulynx_detail'],
  ])('p2_weighting_mode %s -> %s', (raw, expected) => {
    expect(build({ p2_weighting_mode: raw }, 'sdxl-lora', [['p2_weighting_mode', 'string']]).p2_weighting_mode).toBe(expected)
  })

  test('unmapped p2_weighting_mode values pass through', () => {
    expect(build({ p2_weighting_mode: 'off' }, 'sdxl-lora', [['p2_weighting_mode', 'string']]).p2_weighting_mode).toBe('off')
  })

  test.each([
    ['standard', 'classic'], ['default', 'classic'], ['dora', 'classic'],
    ['set', 'lulynx_stopgrad_dora'], ['set_dora', 'lulynx_stopgrad_dora'], ['setdora', 'lulynx_stopgrad_dora'],
    ['stabilized', 'lulynx_stopgrad_dora'], ['lulynx_set_dora', 'lulynx_stopgrad_dora'],
    ['lulynx_stopgrad_dora', 'lulynx_stopgrad_dora'],
    ['garbage', 'classic'],
  ])('dora_variant %s -> %s', (raw, expected) => {
    expect(build({ dora_variant: raw }, 'sdxl-lora', [['dora_variant', 'string']]).dora_variant).toBe(expected)
  })

  test('dp_dmd_variant collapses to standard or lulynx_optimized', () => {
    const fields: FieldSpec[] = [['dp_dmd_variant', 'string']]
    expect(build({ dp_dmd_variant: 'Standard' }, 'sdxl-lora', fields).dp_dmd_variant).toBe('standard')
    expect(build({ dp_dmd_variant: 'anything-else' }, 'sdxl-lora', fields).dp_dmd_variant).toBe('lulynx_optimized')
  })

  test.each([
    ['full', 'full'], ['style', 'style'], ['structure', 'structure'],
    ['wd', 'full'], ['weight_decomposed', 'full'], ['split', 'full'], ['merged', 'full'],
    ['garbage', 'full'], ['STRUCTURE', 'structure'],
  ])('dora_mode %s -> %s (runtime domain from lulynx/dora_layer.py:103-119)', (raw, expected) => {
    expect(build({ dora_mode: raw }, 'sdxl-lora', [['dora_mode', 'string']]).dora_mode).toBe(expected)
  })

  test('legacy svd_grad_proj_* keys migrate to lulynx_svd_gradient_filter_* and are removed', () => {
    const payload = build(
      {
        svd_grad_proj_enabled: true, svd_grad_proj_rank: 32, svd_grad_proj_update_interval: 50,
        svd_grad_proj_scale: 1.5, svd_grad_proj_warmup_steps: 100, svd_grad_proj_target: 'unet',
      },
      'sdxl-lora',
      [
        ['svd_grad_proj_enabled', 'boolean'], ['svd_grad_proj_rank', 'number'], ['svd_grad_proj_update_interval', 'number'],
        ['svd_grad_proj_scale', 'number'], ['svd_grad_proj_warmup_steps', 'number'], ['svd_grad_proj_target', 'string'],
      ],
    )
    expect(pick(payload, [
      'lulynx_svd_gradient_filter_enabled', 'lulynx_svd_gradient_filter_rank',
      'lulynx_svd_gradient_filter_update_interval', 'lulynx_svd_gradient_filter_scale',
      'lulynx_svd_gradient_filter_warmup_steps',
    ])).toEqual({
      lulynx_svd_gradient_filter_enabled: true,
      lulynx_svd_gradient_filter_rank: 32,
      lulynx_svd_gradient_filter_update_interval: 50,
      lulynx_svd_gradient_filter_scale: 1.5,
      lulynx_svd_gradient_filter_warmup_steps: 100,
    })
    for (const key of ['svd_grad_proj_enabled', 'svd_grad_proj_rank', 'svd_grad_proj_update_interval', 'svd_grad_proj_scale', 'svd_grad_proj_warmup_steps', 'svd_grad_proj_target']) {
      expect(payload, key).not.toHaveProperty(key)
    }
  })

  test('an explicit lulynx_svd_gradient_filter_* value wins over the legacy alias', () => {
    const payload = build(
      { svd_grad_proj_rank: 32, lulynx_svd_gradient_filter_rank: 64, svd_grad_proj_enabled: true, lulynx_svd_gradient_filter_enabled: false },
      'sdxl-lora',
      [
        ['svd_grad_proj_rank', 'number'], ['lulynx_svd_gradient_filter_rank', 'number'],
        ['svd_grad_proj_enabled', 'boolean'], ['lulynx_svd_gradient_filter_enabled', 'boolean'],
      ],
    )
    expect(payload.lulynx_svd_gradient_filter_rank).toBe(64)
    expect(payload.lulynx_svd_gradient_filter_enabled).toBe(false)
  })
})

// ─── adapter entity mutex ────────────────────────────────────────────────────

describe('runConfigBuilder: adapter entity mutex', () => {
  const ENTITY_KEYS = [
    'lora2_adaptive_enabled', 'fera_enabled', 'hydralora_enabled', 'vera_enabled', 'lora_fa_enabled',
    't_lora_enabled', 'flexrank_lora_enabled', 'reslora_enabled', 'lora2_enabled', 'tensorring_lora_enabled',
    'dokr_enabled', 'gdlokr_enabled', 'cdka_enabled', 'krona_enabled',
  ]
  const mutexFields: FieldSpec[] = [
    ['network_module', 'string'],
    ['lora_type', 'string'], ['adapter_type', 'string'],
    ...ENTITY_KEYS.map((key) => [key, 'boolean'] as FieldSpec),
    ['dora_enabled', 'boolean'], ['adalora_enabled', 'boolean'], ['delta_lora_enabled', 'boolean'],
    ['use_dora', 'boolean'], ['rs_lora_enabled', 'boolean'], ['lora_plus_enabled', 'boolean'], ['dora_wd', 'boolean'],
    ['dora_mode', 'string'], ['bypass_mode', 'boolean'],
    ['dit_compute_reducer_strategy', 'string'], ['adaptive_caching_enabled', 'boolean'],
    ['turbocore_enabled', 'boolean'], ['turbocore_optimizer_mode', 'string'],
  ]

  const winners = (payload: Cfg) => ENTITY_KEYS.filter((key) => payload[key] === true)

  test('exactly one entity survives when several toggles are on (priority order)', () => {
    // fera 在 ADAPTER_ENTITY_PRIORITY 中排在 vera/dokr 之前。
    const payload = build({ fera_enabled: true, vera_enabled: true, dokr_enabled: true }, 'sdxl-lora', mutexFields)
    expect(winners(payload)).toEqual(['fera_enabled'])
  })

  test('lora2_adaptive (independent injector) beats every elif-chain entity', () => {
    const payload = build({ lora2_adaptive_enabled: true, fera_enabled: true, hydralora_enabled: true }, 'sdxl-lora', mutexFields)
    expect(winners(payload)).toEqual(['lora2_adaptive_enabled'])
  })

  test.each([
    ['vera', 'vera_enabled'],
    ['lora_fa', 'lora_fa_enabled'],
    ['tlora', 't_lora_enabled'],
    ['flexrank', 'flexrank_lora_enabled'],
    ['fera', 'fera_enabled'],
    ['hydralora', 'hydralora_enabled'],
    ['hydra_lora', 'hydralora_enabled'],
    ['gdlokr', 'gdlokr_enabled'],
  ])('lora_type=%s materializes %s and nothing else', (loraType, expectedKey) => {
    const payload = build({ lora_type: loraType }, 'sdxl-lora', mutexFields)
    expect(winners(payload)).toEqual([expectedKey])
  })

  test('lora_type wins over a conflicting *_enabled toggle', () => {
    const payload = build({ lora_type: 'vera', fera_enabled: true }, 'sdxl-lora', mutexFields)
    expect(winners(payload)).toEqual(['vera_enabled'])
  })

  test('adapter_type is an accepted alias of lora_type', () => {
    expect(winners(build({ adapter_type: 'tlora' }, 'newbie-lora', mutexFields))).toEqual(['t_lora_enabled'])
  })

  test('lora_type=dora stays on default LoRALinear and sets both DoRA flags', () => {
    const payload = build({ lora_type: 'dora' }, 'sdxl-lora', mutexFields)
    expect(winners(payload)).toEqual([])
    expect(pick(payload, ['dora_enabled', 'use_dora'])).toEqual({ dora_enabled: true, use_dora: true })
  })

  test('canonical dora_enabled materializes the runtime use_dora route flag', () => {
    const payload = build({ dora_enabled: true }, 'sdxl-lora', mutexFields)
    expect(pick(payload, ['dora_enabled', 'use_dora'])).toEqual({ dora_enabled: true, use_dora: true })
  })

  test('dora_wd canonicalizes aliases and wins over a visible full-mode default', () => {
    const payload = build(
      { dora_wd: true, dora_mode: 'full', bypass_mode: true },
      'sdxl-lora',
      mutexFields,
    )
    expect(pick(payload, ['dora_wd', 'dora_enabled', 'use_dora', 'dora_mode', 'bypass_mode'])).toEqual({
      dora_wd: true,
      dora_enabled: true,
      use_dora: true,
      dora_mode: 'wd',
      bypass_mode: false,
    })
  })

  test('lora_type=rs_lora stays on default LoRALinear and sets rs_lora_enabled', () => {
    const payload = build({ lora_type: 'rs_lora' }, 'sdxl-lora', mutexFields)
    expect(winners(payload)).toEqual([])
    expect(payload.rs_lora_enabled).toBe(true)
  })

  test.each(['dora_enabled', 'use_dora', 'dora_wd', 'adalora_enabled', 'delta_lora_enabled', 'rs_lora_enabled'])(
    'default-LoRA-only rider %s is switched off once another entity wins',
    (rider) => {
      const payload = build({ [rider]: true, vera_enabled: true }, 'sdxl-lora', mutexFields)
      expect(payload[rider]).toBe(false)
      expect(winners(payload)).toEqual(['vera_enabled'])
    },
  )

  test('default-LoRA-only riders survive when no entity replaces LoRALinear', () => {
    const payload = build({ dora_enabled: true, adalora_enabled: true }, 'sdxl-lora', mutexFields)
    expect(pick(payload, ['dora_enabled', 'adalora_enabled'])).toEqual({ dora_enabled: true, adalora_enabled: true })
  })

  test('LoRA+ optimizer groups survive on a specialized adapter entity', () => {
    const payload = build({ dokr_enabled: true, lora_plus_enabled: true }, 'sdxl-lora', mutexFields)
    expect(winners(payload)).toEqual(['dokr_enabled'])
    expect(payload.lora_plus_enabled).toBe(true)
  })

  test('disabled FLUX T-LoRA module does not materialize a native master flag', () => {
    const payload = build({ network_module: 'networks.tlora_flux' }, 'flux-lora', [['network_module', 'string']])
    expect(payload.network_module).toBe('networks.tlora_flux')
    expect(payload).not.toHaveProperty('t_lora_enabled')
  })

  test('a LyCORIS lora_type clears every native entity toggle and DoRA alias', () => {
    const payload = build({ lora_type: 'lokr', vera_enabled: true, dora_wd: true, dora_enabled: true, use_dora: true }, 'sdxl-lora', mutexFields)
    expect(winners(payload)).toEqual([])
    expect(payload.dora_wd).toBe(false)
    expect(payload.dora_enabled).toBe(false)
    expect(payload.use_dora).toBe(false)
  })

  test('DoRA sub-knob residue is purged when the winner leaves the default LoRA route', () => {
    // dora_mode='wd' / bypass_mode=false 是 dora_wd 路线的从属键；切到实体赢家后
    // 必须一并清零，不能以残值形式留在 payload 里。
    const payload = build(
      { lora_type: 'lora', dora_wd: true, dora_enabled: true, use_dora: true, dora_mode: 'wd', bypass_mode: false, vera_enabled: true },
      'sdxl-lora',
      mutexFields,
    )
    expect(winners(payload)).toEqual(['vera_enabled'])
    expect(payload).not.toHaveProperty('dora_mode')
    expect(payload.bypass_mode).toBe(false)
  })

  test('stale dora_mode residue from a restored draft is dropped on an entity route', () => {
    const payload = build({ dora_mode: 'wd', vera_enabled: true }, 'anima-lora', mutexFields)
    expect(payload).not.toHaveProperty('dora_mode')
  })

  test('DoRA stays intact while it remains the rider on default LoRA; legacy wd alias collapses to full', () => {
    // wd 与 full 在运行时（lulynx/dora_layer.py:104）完全同义，统一到规范名；
    // 只有 dora_wd 路线才会按后端 setdefault 语义重新写回 dora_mode='wd'。
    const payload = build({ dora_enabled: true, dora_mode: 'wd', bypass_mode: false }, 'sdxl-lora', mutexFields)
    expect(pick(payload, ['dora_enabled', 'dora_mode'])).toEqual({ dora_enabled: true, dora_mode: 'full' })
  })

  test('legacy string "true" values count as enabled', () => {
    expect(winners(build({ vera_enabled: 'true' }, 'sdxl-lora', mutexFields))).toEqual(['vera_enabled'])
  })

  test('fixed BlockSkip wins over adaptive caching (both would double-skip)', () => {
    const payload = build({ dit_compute_reducer_strategy: 'blockskip', adaptive_caching_enabled: true }, 'sdxl-lora', mutexFields)
    expect(payload.dit_compute_reducer_strategy).toBe('blockskip')
    expect(payload.adaptive_caching_enabled).toBe(false)
  })

  test('adaptive caching survives when the reducer is not blockskip', () => {
    const payload = build({ dit_compute_reducer_strategy: 'none', adaptive_caching_enabled: true }, 'sdxl-lora', mutexFields)
    expect(payload.adaptive_caching_enabled).toBe(true)
  })

  test('TurboCore CUDA forces the Triton optimizer mode off', () => {
    const payload = build({ turbocore_enabled: true, turbocore_optimizer_mode: 'auto' }, 'sdxl-lora', mutexFields)
    expect(payload.turbocore_optimizer_mode).toBe('off')
    const without = build({ turbocore_enabled: false, turbocore_optimizer_mode: 'auto' }, 'sdxl-lora', mutexFields)
    expect(without.turbocore_optimizer_mode).toBe('auto')
  })

  test('turbocore_enabled normalizes execution_core to turbo, otherwise standard', () => {
    const onPayload = build({ turbocore_enabled: true }, 'sdxl-lora', mutexFields)
    expect(onPayload.execution_core).toBe('turbo')
    expect(onPayload.turbocore_enabled).toBe(true)

    const offPayload = build({ turbocore_enabled: false }, 'sdxl-lora', mutexFields)
    expect(offPayload.execution_core).toBe('standard')
    expect(offPayload.turbocore_enabled).toBe(false)

    const defaultPayload = build({}, 'sdxl-lora', mutexFields)
    expect(defaultPayload.execution_core).toBe('standard')

    const peripheralPayload = build({}, 'yolo', [['unrelated', 'string']])
    expect(peripheralPayload).not.toHaveProperty('execution_core')
  })

  test('legacy turbocore_profile values normalize to the supported basic profile', () => {
    expect(build({ turbocore_profile: 'balanced' }, 'sdxl-lora', [['turbocore_profile', 'select']]).turbocore_profile).toBe('basic')
    expect(build({ turbocore_profile: 'aggressive' }, 'sdxl-lora', [['turbocore_profile', 'select']]).turbocore_profile).toBe('basic')
    expect(build({ turbocore_profile: 'fast' }, 'sdxl-lora', [['turbocore_profile', 'select']]).turbocore_profile).toBe('fast')
  })

  test('removeUiOnlyFields strips lulynx_experimental_core_enabled', () => {
    const payload = build({ lulynx_experimental_core_enabled: true }, 'sdxl-lora', [['lulynx_experimental_core_enabled', 'boolean']])
    expect(payload).not.toHaveProperty('lulynx_experimental_core_enabled')
  })
})

// ─── semantic passthrough / universal DiT ────────────────────────────────────

describe('runConfigBuilder: semantic passthrough and universal DiT route', () => {
  const SEMANTIC_KEYS = ['semantic_region_weighting_enabled', 'semantic_segmentation_provider', 'semantic_segmentation_model_path']

  test('semantic region-weighting keys bypass schema visibility entirely', () => {
    // 这三个键由资源中心写入草稿，没有对应 schema section，必须原样透传。
    const payload = build(
      { semantic_region_weighting_enabled: true, semantic_segmentation_provider: 'sam2', semantic_segmentation_model_path: '/m/sam2.pt' },
      'sdxl-lora',
      [['unrelated', 'string']],
    )
    expect(pick(payload, SEMANTIC_KEYS)).toEqual({
      semantic_region_weighting_enabled: true,
      semantic_segmentation_provider: 'sam2',
      semantic_segmentation_model_path: '/m/sam2.pt',
    })
  })

  test('falsy semantic values are still forwarded (explicit off must reach the backend)', () => {
    const payload = build(
      { semantic_region_weighting_enabled: false, semantic_segmentation_provider: '', semantic_segmentation_model_path: '' },
      'sdxl-lora',
      [['unrelated', 'string']],
    )
    expect(pick(payload, SEMANTIC_KEYS)).toEqual({
      semantic_region_weighting_enabled: false,
      semantic_segmentation_provider: '',
      semantic_segmentation_model_path: '',
    })
  })

  test('semantic keys are absent when the draft never set them', () => {
    const payload = build({}, 'sdxl-lora', [['unrelated', 'string']])
    for (const key of SEMANTIC_KEYS) expect(payload, key).not.toHaveProperty(key)
  })

  test('universal DiT is an architecture override on the same route, not a new train type', () => {
    const payload = build({ universal_dit_enabled: true }, 'sdxl-lora', [['universal_dit_enabled', 'boolean']])
    expect(payload.model_type).toBe('universal_dit')
    // 训练类型必须保持原路由。
    expect(payload.model_train_type).toBe('sdxl-lora')
  })

  test('universal DiT off leaves model_type untouched', () => {
    const payload = build({ universal_dit_enabled: false }, 'sdxl-lora', [['universal_dit_enabled', 'boolean']])
    expect(payload).not.toHaveProperty('model_type')
  })
})

// ─── krea2 vram preset × explicitKeys ────────────────────────────────────────

describe('runConfigBuilder: normalizeKrea2VramPreset respects touched keys', () => {
  const KREA2_FIELDS: FieldSpec[] = [
    ['krea2_vram_preset', 'select'],
    ['krea2_block_offload_gpu_slots', 'number'],
    ['krea2_block_offload_prefetch_depth', 'number'],
    ['krea2_block_offload_pin_memory', 'boolean'],
  ]

  function buildKrea2(config: Cfg, explicitKeys?: ReadonlySet<string>): Cfg {
    return buildRunConfigFromSections(config, 'krea2-lora', {
      getSectionsForType: () => [{
        id: 'synthetic',
        tab: 'synthetic',
        title: 'synthetic',
        fields: KREA2_FIELDS.map(([key, type]) => ({ key, type })),
      }],
      isFieldVisible: () => true,
      ...(explicitKeys ? { explicitKeys } : {}),
    }) as unknown as Cfg
  }

  test('untouched standard-tier defaults are stripped so the aggressive preset applies', () => {
    // boolean 字段恒出站（collectVisiblePayload 语义），合成草稿需先注入
    // standard 档默认值，模拟「createDefaultConfig 注入且未触碰」的形态。
    const payload = buildKrea2({
      krea2_vram_preset: 'aggressive',
      krea2_block_offload_gpu_slots: 4,
      krea2_block_offload_prefetch_depth: 2,
      krea2_block_offload_pin_memory: true,
    })
    expect(payload).not.toHaveProperty('krea2_block_offload_gpu_slots')
    expect(payload).not.toHaveProperty('krea2_block_offload_prefetch_depth')
    expect(payload).not.toHaveProperty('krea2_block_offload_pin_memory')
  })

  test('explicitly set standard-tier values survive when marked as user-touched', () => {
    // 表达力契约：aggressive 档下用户显式要 standard 值必须原样出站——
    // 否则后端 model_fields_set 判定会让预设覆写掉用户手填的 4/2/true。
    const touched = new Set(['krea2_block_offload_gpu_slots'])
    const payload = buildKrea2(
      {
        krea2_vram_preset: 'aggressive',
        krea2_block_offload_gpu_slots: 4,
        krea2_block_offload_prefetch_depth: 2,
        krea2_block_offload_pin_memory: true,
      },
      touched,
    )
    expect(payload.krea2_block_offload_gpu_slots).toBe(4)
    expect(payload).not.toHaveProperty('krea2_block_offload_prefetch_depth')
    expect(payload).not.toHaveProperty('krea2_block_offload_pin_memory')
  })

  test('non-aggressive presets ignore the strip rule entirely', () => {
    const payload = buildKrea2(
      { krea2_vram_preset: 'standard', krea2_block_offload_gpu_slots: 4 },
      new Set(['krea2_block_offload_gpu_slots']),
    )
    expect(payload.krea2_block_offload_gpu_slots).toBe(4)
  })
})

// ─── real schema smoke ───────────────────────────────────────────────────────

describe('runConfigBuilder: real schema behaviour', () => {
  test('default drafts submit their own type and no UI-only leftovers', () => {
    for (const typeId of ['sdxl-lora', 'anima-lora', 'sdxl-finetune']) {
      const payload = buildRunConfig(createDefaultConfig(typeId), typeId) as Cfg
      expect(payload.model_train_type, typeId).toBe(typeId)
      for (const key of [
        'optimizer_args_custom', 'network_args_custom', 'prodigy_d0', 'prodigy_d_coef',
        'enable_block_weights', 'enable_base_weight', 'ui_custom_params', 'train_length_mode',
        'layered_alpha_enabled', 'wan22_tower_choice', 'lulynx_experimental_core_enabled',
      ]) {
        expect(payload, `${typeId}/${key}`).not.toHaveProperty(key)
      }
      expect(Object.keys(payload).filter((key) => key.startsWith('opt_')), typeId).toEqual([])
    }
  })

  test('invisible schema fields stay out of the real payload', () => {
    const typeId = 'sdxl-lora'
    const draft = createDefaultConfig(typeId) as Cfg
    const payload = buildRunConfig(draft, typeId) as Cfg
    // universal_dit_* 子字段只在开关打开后可见。
    for (const key of ['universal_dit_probe_mode', 'universal_dit_target_policy']) {
      expect(draft, key).toHaveProperty(key)
      expect(payload, key).not.toHaveProperty(key)
    }
  })

  test('universal-dit-lora registers with a closed surface and pinned universal_dit route', () => {
    const typeId = 'universal-dit-lora'
    const draft = createDefaultConfig(typeId) as Cfg
    const payload = buildRunConfig(draft, typeId) as Cfg
    expect(payload.model_train_type, typeId).toBe(typeId)
    // 专用类型本身就是 universal-dit 路线：开关按后端形态收成 hidden+true，
    // 提交层 normalizeUniversalDitRoute 据此写 model_type（entry_train 显式优先）。
    expect(draft.universal_dit_enabled).toBe(true)
    expect(payload.model_type).toBe('universal_dit')
    expect(payload.network_module).toBe('networks.lora')
    // 契约 JSON 键按探测模式门控：默认 auto 不执行前向 → 不进 payload。
    expect(payload).not.toHaveProperty('universal_dit_forward_mapping_json')
    expect(payload).not.toHaveProperty('universal_dit_output_selector_json')
    expect(payload).not.toHaveProperty('universal_dit_target_modules_json')
    // 实际执行前向的探测模式下，两 JSON 键随草稿进入 payload。
    const probing = buildRunConfig({
      ...draft,
      universal_dit_probe_mode: 'forward',
      universal_dit_forward_mapping_json: '{"cache_key":"forward_kwarg"}',
      universal_dit_output_selector_json: '{"index":0}',
    }, typeId) as Cfg
    expect(probing.universal_dit_forward_mapping_json).toBe('{"cache_key":"forward_kwarg"}')
    expect(probing.universal_dit_output_selector_json).toBe('{"index":0}')
  })

  test('a real LyCORIS lokr draft produces a coherent network_args list', () => {
    const typeId = 'sdxl-lora'
    const draft = {
      ...(createDefaultConfig(typeId) as Cfg),
      network_module: 'lycoris.kohya',
      lycoris_algo: 'lokr',
      conv_dim: 8,
      conv_alpha: 4,
      lokr_factor: 8,
    }
    const payload = buildRunConfig(draft, typeId) as Cfg
    expect(payload.network_module).toBe('lycoris.kohya')
    expect(payload.network_args).toEqual(expect.arrayContaining(['algo=lokr', 'conv_dim=8', 'conv_alpha=4', 'factor=8']))
    expect(payload).not.toHaveProperty('conv_dim')
  })

  test('the real anima layered-alpha section round-trips to network_alpha_map_json', () => {
    const typeId = 'anima-lora'
    expect(getFieldDefinition('layered_alpha_enabled', typeId)).toBeTruthy()
    const draft = {
      ...(createDefaultConfig(typeId) as Cfg),
      layered_alpha_enabled: true,
      alpha_self_attn: 32,
      alpha_mlp: 16,
    }
    const payload = buildRunConfig(draft, typeId) as Cfg
    expect(JSON.parse(String(payload.network_alpha_map_json))).toEqual({ self_attn: 32, mlp: 16 })
  })

  test('wan22_expert_timestep_preset roundtrips when variant is t2v-a14b', () => {
    const typeId = 'wan22-ti2v-lora'
    const draft = {
      ...(createDefaultConfig(typeId) as Cfg),
      wan22_model_variant: 't2v-a14b',
      wan22_expert_timestep_preset: 'high',
    }
    const payload = buildRunConfig(draft, typeId) as Cfg
    expect(payload.wan22_expert_timestep_preset).toBe('high')
  })

  test('turbocore_data_pipeline_enabled submits without requiring turbocore_enabled', () => {
    const typeId = 'sdxl-lora'
    const draft = {
      ...(createDefaultConfig(typeId) as Cfg),
      turbocore_enabled: false,
      turbocore_data_pipeline_enabled: true,
    }
    const payload = buildRunConfig(draft, typeId) as Cfg
    expect(payload.turbocore_data_pipeline_enabled).toBe(true)
    expect(payload.turbocore_enabled).toBe(false)
    expect(payload.execution_core).toBe('standard')
  })

  test('native runtime controls follow the backend architecture support matrix', () => {
    const sdxlField = getFieldDefinition('native_runtime_profile', 'sdxl-lora')
    const animaField = getFieldDefinition('native_runtime_profile', 'anima-lora')
    const newbieField = getFieldDefinition('native_runtime_profile', 'newbie-lora')
    const fluxField = getFieldDefinition('native_runtime_profile', 'flux-lora')
    const steadyField = getFieldDefinition('lulynx_steady_accel', 'anima-lora')
    expect(sdxlField).toBeTruthy()
    expect(animaField).toBeTruthy()
    expect(newbieField).toBeTruthy()
    expect(fluxField).toBeTruthy()

    const sdxlOptions = typeof sdxlField?.options === 'function' ? sdxlField.options({ model_train_type: 'sdxl-lora' }) : sdxlField?.options
    const animaOptions = typeof animaField?.options === 'function' ? animaField.options({ model_train_type: 'anima-lora' }) : animaField?.options
    const newbieOptions = typeof newbieField?.options === 'function' ? newbieField.options({ model_train_type: 'newbie-lora' }) : newbieField?.options

    const sdxlValues = (sdxlOptions as Array<{ value: string }>).map((o) => o.value)
    const animaValues = (animaOptions as Array<{ value: string }>).map((o) => o.value)
    const newbieValues = (newbieOptions as Array<{ value: string }>).map((o) => o.value)

    expect(sdxlValues).toEqual(['standard', 'aggressive'])
    expect(animaValues).toEqual(['standard', 'aggressive', 'anima_fast', 'anima_low_vram', 'anima_experimental'])
    expect(newbieValues).toEqual(['standard', 'aggressive', 'anima_fast'])
    expect(isFieldVisible(fluxField!, { model_train_type: 'flux-lora', performance_expert_mode: true })).toBe(false)
    expect(isFieldVisible(steadyField!, { model_train_type: 'sdxl-lora' })).toBe(false)
    expect(isFieldVisible(steadyField!, { model_train_type: 'newbie-lora' })).toBe(true)

    const sdxlDraft: Cfg = { ...(createDefaultConfig('sdxl-lora') as Cfg), performance_expert_mode: true, native_runtime_profile: 'anima_fast' }
    sdxlDraft.model_type = 'anima'
    const newbieDraft = { ...(createDefaultConfig('newbie-lora') as Cfg), performance_expert_mode: true, native_runtime_profile: 'anima_fast' }
    const fluxDraft = { ...(createDefaultConfig('flux-lora') as Cfg), performance_expert_mode: true, native_runtime_profile: 'aggressive' }
    expect((buildRunConfig(sdxlDraft, 'sdxl-lora') as Cfg).native_runtime_profile).toBe('standard')
    expect((buildRunConfig(newbieDraft, 'newbie-lora') as Cfg).native_runtime_profile).toBe('anima_fast')
    expect(buildRunConfig(fluxDraft, 'flux-lora')).not.toHaveProperty('native_runtime_profile')
  })

  test('TurboCore product section participates in the standard wizard path', () => {
    const section = getSectionsForType('sdxl-lora').find((item) => item.id === 'turbocore-settings')
    expect(section).toBeTruthy()
    expect((section as typeof section & { expert?: boolean })?.expert).toBe(false)
  })
})
