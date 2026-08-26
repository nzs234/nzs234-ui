// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 本地 inventory → 训练字段路径匹配。
 *
 * 这层的错误是「悄悄把错的模型填进去」：把 LoRA 填到底模位、把 VAE 填到 DiT 位、
 * 或者把上一个训练类型的权重填进新类型。因此保守策略有三道闸：
 *   1. 角色过滤(roleFilter) —— 字段名决定接受哪类产物；
 *   2. family 门禁 —— 底模位必须同族，否则宁可不填；
 *   3. 唯一性 —— 多候选只列不填。
 * 这三条各自失效都不会报错，只会给出一个"看着像填好了"的配置。
 */

import { describe, expect, test } from 'vitest'
import {
  applyUniqueAutofill,
  fieldAllowsAutofill,
  filterCandidatesForField,
  familiesForTypeId,
  isPathEmptyForAutofill,
  isPlaceholderDefault,
  normalizeResourceItems,
  uniqueAutofillPath,
  type PathCandidate,
  type SchemaFieldLike,
} from './modelPathMatch'

function candidate(extra: Partial<PathCandidate> = {}): PathCandidate {
  return {
    path: 'D:/models/base.safetensors',
    name: 'base.safetensors',
    model_family: '',
    model_type: '',
    artifact_kind: '',
    size: 100,
    modified_at: '',
    tags: [],
    ...extra,
  }
}

// ─── familiesForTypeId ───────────────────────────────────────────────────────

describe('modelPathMatch: familiesForTypeId', () => {
  test('已知前缀映射到对应族', () => {
    expect(familiesForTypeId('anima-lora')).toEqual(['anima'])
    expect(familiesForTypeId('newbie-finetune')).toEqual(['newbie'])
    expect(familiesForTypeId('boogu-lora')).toEqual(['boogu'])
    expect(familiesForTypeId('flux-lora')).toEqual(['flux'])
    expect(familiesForTypeId('sdxl-lora')).toEqual(['sdxl'])
  })

  test('多别名族返回全部候选写法', () => {
    expect(familiesForTypeId('krea2-lora')).toEqual(['krea2', 'krea'])
    expect(familiesForTypeId('wan22-lora')).toEqual(['wan', 'wan22', 'wan2.2', 'wan2'])
    expect(familiesForTypeId('sd15-lora')).toEqual(['sd15', 'sd1.5'])
  })

  test('sdxl 先于 sd1 判定，不会被 sd 前缀吞掉', () => {
    // 顺序反了的话 sdxl 会落进 sd15 族，底模 family 门禁就全错。
    expect(familiesForTypeId('sdxl-finetune')).toEqual(['sdxl'])
  })

  test('大小写无关，未知前缀与空输入返回空数组', () => {
    expect(familiesForTypeId('SDXL-LORA')).toEqual(['sdxl'])
    expect(familiesForTypeId('lab-distiller')).toEqual([])
    expect(familiesForTypeId('')).toEqual([])
    expect(familiesForTypeId(null as unknown as string)).toEqual([])
  })
})

// ─── 占位判定 ───────────────────────────────────────────────────────────────

describe('modelPathMatch: isPlaceholderDefault', () => {
  test('空值一律当占位', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(isPlaceholderDefault(value), String(value)).toBe(true)
    }
  })

  test('历史 ./sd-models 假路径始终当占位（正反斜杠都算）', () => {
    expect(isPlaceholderDefault('./sd-models/model.safetensors')).toBe(true)
    expect(isPlaceholderDefault('.\\sd-models\\model.safetensors')).toBe(true)
    expect(isPlaceholderDefault('./sd-models/anything/else.safetensors')).toBe(true)
  })

  test('等于 schema 默认且默认是相对路径 → 占位', () => {
    const field: SchemaFieldLike = { key: 'pretrained_model_name_or_path', defaultValue: './models/x.safetensors' }
    expect(isPlaceholderDefault('./models/x.safetensors', field)).toBe(true)
  })

  test('等于 schema 默认且默认含 model.safetensors → 占位', () => {
    const field: SchemaFieldLike = { key: 'k', defaultValue: 'D:/anywhere/model.safetensors' }
    expect(isPlaceholderDefault('D:/anywhere/model.safetensors', field)).toBe(true)
  })

  test('等于 schema 默认但默认是个普通绝对路径 → 不算占位', () => {
    // 用户可能真的把默认路径当成自己的选择；只有形如占位的默认才当空。
    const field: SchemaFieldLike = { key: 'k', defaultValue: 'D:/models/real.safetensors' }
    expect(isPlaceholderDefault('D:/models/real.safetensors', field)).toBe(false)
  })

  test('真实绝对路径不算占位；不传 field 时只看历史假路径', () => {
    expect(isPlaceholderDefault('D:/models/real.safetensors')).toBe(false)
    expect(isPlaceholderDefault('./my-own/model2.ckpt')).toBe(false)
  })

  test('比较前会 trim 两侧空白', () => {
    const field: SchemaFieldLike = { key: 'k', defaultValue: './x' }
    expect(isPlaceholderDefault('  ./x  ', field)).toBe(true)
  })
})

describe('modelPathMatch: isPathEmptyForAutofill', () => {
  test('空值与占位都算"可填"', () => {
    expect(isPathEmptyForAutofill('')).toBe(true)
    expect(isPathEmptyForAutofill('./sd-models/model.safetensors')).toBe(true)
  })

  test('用户已填的真实路径不可覆盖', () => {
    expect(isPathEmptyForAutofill('D:/models/real.safetensors')).toBe(false)
  })
})

// ─── fieldAllowsAutofill ────────────────────────────────────────────────────

describe('modelPathMatch: fieldAllowsAutofill', () => {
  test('network_weights 与 resume 只允许手动选', () => {
    // 续训权重填错等于用别的 run 的状态接着训，代价远高于"少填一格"。
    expect(fieldAllowsAutofill('network_weights')).toBe(false)
    expect(fieldAllowsAutofill('NETWORK_WEIGHTS')).toBe(false)
    expect(fieldAllowsAutofill('resume')).toBe(false)
  })

  test('其余模型字段允许自动填', () => {
    expect(fieldAllowsAutofill('pretrained_model_name_or_path')).toBe(true)
    expect(fieldAllowsAutofill('vae')).toBe(true)
  })
})

// ─── normalizeResourceItems ─────────────────────────────────────────────────

describe('modelPathMatch: normalizeResourceItems', () => {
  test('缺 path 的行与非对象行被丢弃', () => {
    const items = normalizeResourceItems([null, undefined, 'str', 42, {}, { path: '   ' }, { path: 'D:/a.safetensors' }])
    expect(items).toHaveLength(1)
    expect(items[0].path).toBe('D:/a.safetensors')
  })

  test('name 缺失时从路径尾段推断（正反斜杠都支持）', () => {
    expect(normalizeResourceItems([{ path: 'D:/models/x.safetensors' }])[0].name).toBe('x.safetensors')
    expect(normalizeResourceItems([{ path: 'D:\\models\\y.ckpt' }])[0].name).toBe('y.ckpt')
  })

  test('artifact_kind 缺失时回落到 kind', () => {
    expect(normalizeResourceItems([{ path: 'D:/a', kind: 'checkpoint' }])[0].artifact_kind).toBe('checkpoint')
    expect(normalizeResourceItems([{ path: 'D:/a', kind: 'lora', artifact_kind: 'checkpoint' }])[0].artifact_kind)
      .toBe('checkpoint')
  })

  test('size 非数字归零，tags 非数组归空', () => {
    const item = normalizeResourceItems([{ path: 'D:/a', size: 'big', tags: 'nope' }])[0]
    expect(item.size).toBe(0)
    expect(item.tags).toEqual([])
  })

  test('tags 元素被字符串化，其余字段缺失时为空串', () => {
    const item = normalizeResourceItems([{ path: 'D:/a', tags: ['x', 7] }])[0]
    expect(item.tags).toEqual(['x', '7'])
    expect(item.model_family).toBe('')
    expect(item.modified_at).toBe('')
  })

  test('传入 nullish 数组时返回空结果', () => {
    expect(normalizeResourceItems(null as unknown as unknown[])).toEqual([])
  })
})

// ─── 角色过滤 ───────────────────────────────────────────────────────────────

describe('modelPathMatch: roleFilter — LoRA 权重位', () => {
  const forKey = (items: PathCandidate[], key: string) => filterCandidatesForField(items, 'sdxl-lora', key)

  test('network_weights 只接受 LoRA 类产物', () => {
    const lora = candidate({ path: 'D:/loras/a.safetensors', artifact_kind: 'lora' })
    const ckpt = candidate({ path: 'D:/models/b.safetensors', artifact_kind: 'checkpoint' })
    expect(forKey([lora, ckpt], 'network_weights').map((i) => i.path)).toEqual([lora.path])
  })

  test('acceleration_lora / acceleration-lora 都算 LoRA', () => {
    for (const kind of ['acceleration_lora', 'acceleration-lora']) {
      const item = candidate({ path: 'D:/x/acc.safetensors', artifact_kind: kind })
      expect(forKey([item], 'network_weights'), kind).toHaveLength(1)
    }
  })

  test('kind 未知但路径含 lora 也算；同时含 checkpoint 则排除', () => {
    const byPath = candidate({ path: 'D:/loras/x.safetensors' })
    const ambiguous = candidate({ path: 'D:/loras/checkpoint-x.safetensors' })
    expect(forKey([byPath], 'network_weights')).toHaveLength(1)
    expect(forKey([ambiguous], 'network_weights')).toHaveLength(0)
  })

  test('形如 xxx_lora_weight 的键同样按 LoRA 位过滤', () => {
    const ckpt = candidate({ artifact_kind: 'checkpoint' })
    expect(forKey([ckpt], 'extra_lora_weights')).toHaveLength(0)
  })

  test('model_type 也参与 kind 判定', () => {
    const item = candidate({ path: 'D:/x/a.safetensors', model_type: 'lora' })
    expect(forKey([item], 'network_weights')).toHaveLength(1)
  })
})

describe('modelPathMatch: roleFilter — VAE 位', () => {
  const forKey = (items: PathCandidate[], key: string) => filterCandidatesForField(items, 'sdxl-lora', key)

  test('vae / *_vae / *vae_path* 都走 VAE 过滤', () => {
    const vae = candidate({ path: 'D:/vae/sdxl-vae.safetensors', artifact_kind: 'vae' })
    const ckpt = candidate({ path: 'D:/models/base.safetensors', artifact_kind: 'checkpoint' })
    for (const key of ['vae', 'sdxl_vae', 'custom_vae_path_extra']) {
      expect(forKey([vae, ckpt], key).map((i) => i.path), key).toEqual([vae.path])
    }
  })

  test('kind 不是 vae 但路径里带 vae 也接受', () => {
    const item = candidate({ path: 'D:/models/vae-ft-mse.safetensors' })
    expect(forKey([item], 'vae')).toHaveLength(1)
  })

  test('tags 里带 vae 同样命中（haystack 覆盖 tags）', () => {
    const item = candidate({ path: 'D:/models/mystery.safetensors', tags: ['vae'] })
    expect(forKey([item], 'vae')).toHaveLength(1)
  })
})

describe('modelPathMatch: roleFilter — 文本编码器 / LLM 位', () => {
  const forKey = (items: PathCandidate[], key: string) => filterCandidatesForField(items, 'sdxl-lora', key)

  test('qwen3 / llm / text_encoder / clip / tokenizer 键走 LLM 过滤', () => {
    const te = candidate({ path: 'D:/te/clip_l.safetensors' })
    const ckpt = candidate({ path: 'D:/models/base.safetensors', artifact_kind: 'checkpoint' })
    for (const key of ['qwen3', 'llm_path', 'text_encoder_1', 'clip_l', 'tokenizer_dir']) {
      expect(forKey([te, ckpt], key).map((i) => i.path), key).toEqual([te.path])
    }
  })

  test('qwen 目录按 LLM 命中', () => {
    const item = candidate({ path: 'D:/models/Qwen2.5-VL', artifact_kind: '' })
    expect(forKey([item], 'qwen3')).toHaveLength(1)
  })

  test('与 LLM 无关的底模不会被填进文本编码器位', () => {
    const item = candidate({ path: 'D:/models/base.safetensors', artifact_kind: 'checkpoint' })
    expect(forKey([item], 'text_encoder')).toHaveLength(0)
  })
})

describe('modelPathMatch: roleFilter — 主权重位', () => {
  const forKey = (items: PathCandidate[], key: string, typeId = 'sdxl-lora') =>
    filterCandidatesForField(items, typeId, key)

  test('checkpoint/dit/unet/transformer/base 类 kind 被接受', () => {
    for (const kind of ['checkpoint', 'dit', 'unet', 'transformer', 'base']) {
      const item = candidate({ artifact_kind: kind, model_family: 'sdxl' })
      expect(forKey([item], 'pretrained_model_name_or_path'), kind).toHaveLength(1)
    }
  })

  test('空 kind / model / file 的同族文件也接受', () => {
    for (const kind of ['', 'model', 'file']) {
      const item = candidate({ artifact_kind: kind, model_family: 'sdxl' })
      expect(forKey([item], 'pretrained_model_name_or_path'), kind || '(empty)').toHaveLength(1)
    }
  })

  test('LoRA 与 VAE 绝不进主权重位', () => {
    const lora = candidate({ path: 'D:/loras/a.safetensors', artifact_kind: 'lora', model_family: 'sdxl' })
    const vae = candidate({ path: 'D:/vae/v.safetensors', artifact_kind: 'vae', model_family: 'sdxl' })
    expect(forKey([lora, vae], 'pretrained_model_name_or_path')).toHaveLength(0)
  })

  test('kind 未知但路径落在 vae 目录下的文件被排除', () => {
    const item = candidate({ path: 'D:/models/vae/mystery.safetensors', artifact_kind: 'unknown-kind', model_family: 'sdxl' })
    expect(forKey([item], 'pretrained_model_name_or_path')).toHaveLength(0)
  })

  test('dit / unet / transformer 键与 pretrained 键共用主权重规则', () => {
    const item = candidate({ artifact_kind: 'checkpoint', model_family: 'sdxl' })
    for (const key of ['dit_path', 'unet_model', 'transformer_weights']) {
      // 这些键 requireFamily 默认 false，走软偏好分支。
      expect(forKey([item], key), key).toHaveLength(1)
    }
  })

  test('其它 model-file 键默认只排除 LoRA', () => {
    const lora = candidate({ path: 'D:/loras/a.safetensors', artifact_kind: 'lora' })
    const other = candidate({ path: 'D:/models/misc.safetensors', artifact_kind: 'controlnet' })
    expect(forKey([lora, other], 'controlnet_model').map((i) => i.path)).toEqual([other.path])
  })
})

// ─── family 门禁 ────────────────────────────────────────────────────────────

describe('modelPathMatch: family 门禁', () => {
  test('底模位强制同族：异族文件被丢掉', () => {
    const sdxl = candidate({ path: 'D:/models/sdxl-base.safetensors', model_family: 'sdxl', artifact_kind: 'checkpoint' })
    const flux = candidate({ path: 'D:/models/flux-base.safetensors', model_family: 'flux', artifact_kind: 'checkpoint' })
    const hits = filterCandidatesForField([sdxl, flux], 'sdxl-lora', 'pretrained_model_name_or_path')
    expect(hits.map((i) => i.path)).toEqual([sdxl.path])
  })

  test('typeId 无族可推断时底模位直接返回空（宁可不填）', () => {
    const item = candidate({ artifact_kind: 'checkpoint', model_family: 'whatever' })
    expect(filterCandidatesForField([item], 'lab-distiller', 'pretrained_model_name_or_path')).toEqual([])
  })

  test('model_family 为空时用路径/名字兜底判族', () => {
    const item = candidate({ path: 'D:/models/sdxl/base.safetensors', artifact_kind: 'checkpoint' })
    expect(filterCandidatesForField([item], 'sdxl-lora', 'pretrained_model_name_or_path')).toHaveLength(1)
  })

  test('族名双向包含都算命中（wan22 ↔ wan）', () => {
    const item = candidate({ artifact_kind: 'checkpoint', model_family: 'wan2.2' })
    expect(filterCandidatesForField([item], 'wan22-lora', 'pretrained_model_name_or_path')).toHaveLength(1)
  })

  test('requireFamily 可显式打开/关闭', () => {
    const flux = candidate({ path: 'D:/models/flux.safetensors', model_family: 'flux', artifact_kind: 'checkpoint' })
    expect(filterCandidatesForField([flux], 'sdxl-lora', 'pretrained_model_name_or_path', { requireFamily: false }))
      .toHaveLength(1)
    expect(filterCandidatesForField([flux], 'sdxl-lora', 'controlnet_model', { requireFamily: true }))
      .toHaveLength(0)
  })

  test('非底模位是软偏好：有同族就只留同族', () => {
    const sdxlVae = candidate({ path: 'D:/vae/sdxl-vae.safetensors', artifact_kind: 'vae', model_family: 'sdxl' })
    const fluxVae = candidate({ path: 'D:/vae/flux-ae.safetensors', artifact_kind: 'vae', model_family: 'flux' })
    const hits = filterCandidatesForField([sdxlVae, fluxVae], 'sdxl-lora', 'vae')
    expect(hits.map((i) => i.path)).toEqual([sdxlVae.path])
  })

  test('非底模位没有同族命中时保留全部（VAE/LLM 常常没有 family）', () => {
    const anyVae = candidate({ path: 'D:/vae/generic.safetensors', artifact_kind: 'vae' })
    expect(filterCandidatesForField([anyVae], 'sdxl-lora', 'vae')).toHaveLength(1)
  })
})

// ─── 排序与截断 ─────────────────────────────────────────────────────────────

describe('modelPathMatch: 排序与 limit', () => {
  test('先按体积降序（大的更可能是主权重）', () => {
    const small = candidate({ path: 'D:/models/small.safetensors', size: 10, model_family: 'sdxl', artifact_kind: 'checkpoint' })
    const big = candidate({ path: 'D:/models/big.safetensors', size: 999, model_family: 'sdxl', artifact_kind: 'checkpoint' })
    const hits = filterCandidatesForField([small, big], 'sdxl-lora', 'pretrained_model_name_or_path')
    expect(hits.map((i) => i.path)).toEqual([big.path, small.path])
  })

  test('同体积按 modified_at 降序', () => {
    const older = candidate({ path: 'D:/models/older.safetensors', size: 10, modified_at: '2026-01-01', model_family: 'sdxl', artifact_kind: 'checkpoint' })
    const newer = candidate({ path: 'D:/models/newer.safetensors', size: 10, modified_at: '2026-02-01', model_family: 'sdxl', artifact_kind: 'checkpoint' })
    const hits = filterCandidatesForField([older, newer], 'sdxl-lora', 'pretrained_model_name_or_path')
    expect(hits.map((i) => i.path)).toEqual([newer.path, older.path])
  })

  test('排序不修改入参数组顺序', () => {
    const a = candidate({ path: 'D:/models/a.safetensors', size: 1, model_family: 'sdxl', artifact_kind: 'checkpoint' })
    const b = candidate({ path: 'D:/models/b.safetensors', size: 9, model_family: 'sdxl', artifact_kind: 'checkpoint' })
    const input = [a, b]
    filterCandidatesForField(input, 'sdxl-lora', 'pretrained_model_name_or_path')
    expect(input.map((i) => i.path)).toEqual([a.path, b.path])
  })

  test('默认截断 12 条，limit 可覆盖', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      candidate({ path: `D:/models/m${i}.safetensors`, size: i, model_family: 'sdxl', artifact_kind: 'checkpoint' }),
    )
    expect(filterCandidatesForField(items, 'sdxl-lora', 'pretrained_model_name_or_path')).toHaveLength(12)
    expect(filterCandidatesForField(items, 'sdxl-lora', 'pretrained_model_name_or_path', { limit: 3 })).toHaveLength(3)
  })
})

// ─── uniqueAutofillPath ─────────────────────────────────────────────────────

describe('modelPathMatch: uniqueAutofillPath', () => {
  const base = (name: string) =>
    candidate({ path: `D:/models/${name}.safetensors`, model_family: 'sdxl', artifact_kind: 'checkpoint' })

  test('唯一候选才返回路径', () => {
    expect(uniqueAutofillPath([base('one')], 'sdxl-lora', 'pretrained_model_name_or_path'))
      .toBe('D:/models/one.safetensors')
  })

  test('多候选返回 null（只列不填）', () => {
    expect(uniqueAutofillPath([base('a'), base('b')], 'sdxl-lora', 'pretrained_model_name_or_path')).toBeNull()
  })

  test('零候选返回 null', () => {
    expect(uniqueAutofillPath([], 'sdxl-lora', 'pretrained_model_name_or_path')).toBeNull()
  })

  test('不允许自动填的字段直接 null，即使只有一个候选', () => {
    const lora = candidate({ path: 'D:/loras/only.safetensors', artifact_kind: 'lora' })
    expect(uniqueAutofillPath([lora], 'sdxl-lora', 'network_weights')).toBeNull()
    expect(uniqueAutofillPath([lora], 'sdxl-lora', 'resume')).toBeNull()
  })
})

// ─── applyUniqueAutofill ────────────────────────────────────────────────────

describe('modelPathMatch: applyUniqueAutofill', () => {
  const ckpt = candidate({ path: 'D:/models/base.safetensors', model_family: 'sdxl', artifact_kind: 'checkpoint' })
  const vae = candidate({ path: 'D:/vae/only.safetensors', artifact_kind: 'vae' })

  test('空字段被填上唯一候选', () => {
    const fields: SchemaFieldLike[] = [{ key: 'pretrained_model_name_or_path', type: 'file' }]
    expect(applyUniqueAutofill({ pretrained_model_name_or_path: '' }, 'sdxl-lora', [ckpt], fields))
      .toEqual({ pretrained_model_name_or_path: ckpt.path })
  })

  test('占位默认值也被视为空并覆盖', () => {
    const fields: SchemaFieldLike[] = [
      { key: 'pretrained_model_name_or_path', type: 'file', defaultValue: './sd-models/model.safetensors' },
    ]
    const draft = { pretrained_model_name_or_path: './sd-models/model.safetensors' }
    expect(applyUniqueAutofill(draft, 'sdxl-lora', [ckpt], fields))
      .toEqual({ pretrained_model_name_or_path: ckpt.path })
  })

  test('用户已填的真实路径绝不覆盖', () => {
    const fields: SchemaFieldLike[] = [{ key: 'pretrained_model_name_or_path', type: 'file' }]
    const draft = { pretrained_model_name_or_path: 'D:/mine/chosen.safetensors' }
    expect(applyUniqueAutofill(draft, 'sdxl-lora', [ckpt], fields)).toEqual({})
  })

  test('只处理 file 类型或 model-file picker 的字段', () => {
    const fields: SchemaFieldLike[] = [
      { key: 'vae', type: 'string', pickerType: 'model-file' },
      { key: 'output_dir', type: 'folder', pickerType: 'folder' },
      { key: 'output_name', type: 'string' },
    ]
    const draft = { vae: '', output_dir: '', output_name: '' }
    expect(applyUniqueAutofill(draft, 'sdxl-lora', [vae], fields)).toEqual({ vae: vae.path })
  })

  test('network_weights / resume 即使为空也跳过', () => {
    const lora = candidate({ path: 'D:/loras/only.safetensors', artifact_kind: 'lora' })
    const fields: SchemaFieldLike[] = [
      { key: 'network_weights', type: 'file' },
      { key: 'resume', type: 'file' },
    ]
    expect(applyUniqueAutofill({ network_weights: '', resume: '' }, 'sdxl-lora', [lora], fields)).toEqual({})
  })

  test('多候选的字段不出现在 updates 里', () => {
    const other = candidate({ path: 'D:/models/other.safetensors', model_family: 'sdxl', artifact_kind: 'checkpoint' })
    const fields: SchemaFieldLike[] = [{ key: 'pretrained_model_name_or_path', type: 'file' }]
    expect(applyUniqueAutofill({}, 'sdxl-lora', [ckpt, other], fields)).toEqual({})
  })

  test('多个字段可以在一次调用里各自填上', () => {
    const fields: SchemaFieldLike[] = [
      { key: 'pretrained_model_name_or_path', type: 'file' },
      { key: 'vae', type: 'file' },
    ]
    expect(applyUniqueAutofill({}, 'sdxl-lora', [ckpt, vae], fields)).toEqual({
      pretrained_model_name_or_path: ckpt.path,
      vae: vae.path,
    })
  })

  test('空字段表返回空 updates', () => {
    expect(applyUniqueAutofill({}, 'sdxl-lora', [ckpt], [])).toEqual({})
  })
})
